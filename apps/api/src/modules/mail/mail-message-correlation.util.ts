/**
 * Slice C §13 (hardened) — the one internal utility for Message-ID / In-Reply-To / References
 * parsing/canonicalization. No fuzzy subject matching anywhere in this codebase; correlation
 * (mail-inbound-correlation.service.ts) operates exclusively on the normalized tokens this file
 * produces.
 *
 * Normalized form: each identifier is wrapped in exactly one pair of angle brackets, e.g.
 * "<uuid@domain>" — this is deliberately the exact format generateStableMessageId() (Slice B)
 * produces and EmailMessage.externalMessageId stores, so an inbound reply's In-Reply-To/References
 * header reliably string-matches a prior outbound row's externalMessageId. Identifier CONTENT is
 * never lowercased or otherwise mutated — RFC 5322 msg-id content is case-sensitive — only
 * insignificant surrounding whitespace (including header-folding whitespace) is trimmed and the
 * bracket representation is normalized.
 *
 * HARDENED IDENTITY RULE (correction pass): a token is only ever treated as a usable msg-id if it
 * passes strict syntactic validation (isValidMsgIdContent) — arbitrary malformed text is NEVER
 * wrapped into a fabricated "<...>" identity merely because code surrounds it with brackets. A
 * token exceeding the EmailMessage.externalMessageId/inReplyTo column width (VarChar(500)) is
 * likewise REJECTED outright, never truncated — truncating an identity field risks two distinct
 * over-length ids colliding on the same stored/compared prefix, which would be a false-positive
 * thread-correlation bug, not a cosmetic one.
 */

/** Matches EmailMessage.externalMessageId / EmailMessage.inReplyTo's `@db.VarChar(500)` width
 * (schema.prisma) — the normalized "<...>" form (including brackets) must fit this exactly, or the
 * token is discarded rather than truncated. */
export const MAX_MESSAGE_ID_LENGTH = 500;

/** Bounds how much of a raw header value is ever fed to the tokenizer, and how many tokens are
 * ever extracted from one header — defense against a pathologically large References header
 * consuming unbounded CPU/memory before any per-token length check even runs. Chosen generously
 * above any real mail client's output while still being a hard, cheap ceiling. */
const MAX_HEADER_SCAN_LENGTH = 20_000;
const MAX_TOKENS_PER_HEADER = 200;

/**
 * Strict syntactic check for msg-id CONTENT (the part between "<" and ">", or a bare candidate with
 * no brackets at all). Deliberately conservative relative to the full RFC 5322 msg-id grammar —
 * the goal is "reject anything that is obviously not an identifier", not "accept every technically
 * legal RFC 5322 edge case":
 *   - no control characters, no whitespace of any kind (a real msg-id never contains either)
 *   - no further "<" or ">" characters
 *   - exactly one "@", with at least one character on each side
 */
function isValidMsgIdContent(inner: string): boolean {
  if (!inner) return false;
  if (inner.length > MAX_MESSAGE_ID_LENGTH - 2) return false; // -2 for the "<" ">" wrapper.
  // eslint-disable-next-line no-control-regex -- deliberately matching raw control bytes to reject them.
  if (/[\x00-\x1f\x7f]/.test(inner)) return false;
  if (/\s/.test(inner)) return false;
  if (inner.includes('<') || inner.includes('>')) return false;
  const atIndex = inner.indexOf('@');
  if (atIndex <= 0) return false; // no '@', or '@' is the first character (empty local part).
  if (atIndex !== inner.lastIndexOf('@')) return false; // more than one '@'.
  if (atIndex === inner.length - 1) return false; // '@' is the last character (empty domain part).
  return true;
}

function normalizeSingleMessageId(inner: string): string | null {
  return isValidMsgIdContent(inner) ? `<${inner}>` : null;
}

/**
 * Extracts every SYNTACTICALLY VALID msg-id token from a raw In-Reply-To or References header
 * value. A "<...>" token whose content fails validation (malformed, oversized, containing
 * whitespace/control characters) is dropped, never fabricated into a usable identity. When the
 * header contains no bracketed tokens at all, the whole trimmed value is tried as ONE bare
 * candidate (§ "plausible bare msg-id") and is likewise dropped unless it independently passes the
 * same strict validation — it is never wrapped and accepted merely because it was the only content
 * present.
 */
export function parseMessageIdTokens(rawHeaderValue: string | null | undefined): string[] {
  if (!rawHeaderValue) return [];
  const collapsed = rawHeaderValue.replace(/\s+/g, ' ').trim().slice(0, MAX_HEADER_SCAN_LENGTH);
  if (!collapsed) return [];

  const bracketed = collapsed.match(/<[^<>]*>/g);
  if (bracketed && bracketed.length > 0) {
    const results: string[] = [];
    for (const token of bracketed.slice(0, MAX_TOKENS_PER_HEADER)) {
      const inner = token.slice(1, -1).trim();
      const normalized = normalizeSingleMessageId(inner);
      if (normalized) results.push(normalized);
    }
    return results;
  }

  const fallback = normalizeSingleMessageId(collapsed);
  return fallback ? [fallback] : [];
}

/** Convenience for headers expected to carry a single identifier (In-Reply-To). */
export function parsePrimaryMessageId(rawHeaderValue: string | null | undefined): string | null {
  return parseMessageIdTokens(rawHeaderValue)[0] ?? null;
}

/**
 * Slice C §7 (hardened) — builds the value persisted into EmailMessage.references (a TEXT column;
 * see mail-inbound-body.util.ts for the same MariaDB TEXT byte-limit reasoning) from COMPLETE,
 * already-validated tokens only. Tokens are appended, space-separated, stopping BEFORE the next
 * complete token would push the UTF-8 byte length past `maxBytes` — never truncating a token
 * mid-string. Returns undefined when there is nothing to store.
 */
export function buildReferencesStorageValue(tokens: string[], maxBytes: number): string | undefined {
  if (tokens.length === 0) return undefined;
  let result = '';
  for (const token of tokens) {
    const candidate = result ? `${result} ${token}` : token;
    if (Buffer.byteLength(candidate, 'utf8') > maxBytes) break;
    result = candidate;
  }
  return result || undefined;
}
