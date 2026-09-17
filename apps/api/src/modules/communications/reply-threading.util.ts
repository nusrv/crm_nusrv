import { MAX_BODY_TEXT_BYTES } from '../mail/mail-inbound-body.util';
import { buildReferencesStorageValue, parseMessageIdTokens, parsePrimaryMessageId } from '../mail/mail-message-correlation.util';

const MAX_REPLY_SUBJECT_LENGTH = 500; // matches EmailMessage.subject's own VarChar(500) width.

/** §10 (contract audit) — how many of the thread's most recent messages the threading-source
 * search considers, newest first, before giving up and omitting In-Reply-To. Small and bounded —
 * this is a fallback for "the very latest message happens to have no usable identity," not a
 * general thread-history scan. */
export const MAX_THREADING_CANDIDATE_MESSAGES = 5;

/**
 * Slice E §12 — derives exactly one "Re: <subject>" from a base subject, stripping any existing
 * leading Re:/RE:/re: prefixes (one or more, any casing) first, so a chain of replies never
 * accumulates into "Re: Re: Re: ...". Never invents a subject: an empty/whitespace-only base still
 * produces a bounded, non-empty "Re:" rather than an empty string.
 */
export function normalizeReplySubject(baseSubject: string): string {
  const stripped = baseSubject.replace(/^(\s*re\s*:\s*)+/i, '').trim();
  const candidate = stripped ? `Re: ${stripped}` : 'Re:';
  return candidate.length > MAX_REPLY_SUBJECT_LENGTH ? candidate.slice(0, MAX_REPLY_SUBJECT_LENGTH) : candidate;
}

export interface ReplyThreadingSource {
  externalMessageId: string | null;
  references: string | null;
}

export interface ReplyThreadingHeaders {
  inReplyTo: string | null;
  references: string | undefined;
}

/**
 * Slice E §11/§10 (hardened) — derives In-Reply-To/References for a human reply. `candidates` must
 * already be ordered newest-first (occurredAt DESC, id DESC) and bounded to
 * MAX_THREADING_CANDIDATE_MESSAGES by the caller. Reuses Slice C's exact
 * parse/re-validate/rebuild/bound pipeline (mail-message-correlation.util.ts) rather than
 * reimplementing it — the same "never truncate mid-token" and byte-bounding guarantees apply
 * symmetrically here.
 *
 * The chronologically latest message is never blindly trusted: its own externalMessageId is
 * re-validated through the exact same strict parser Slice C's own ingest path uses
 * (parsePrimaryMessageId — rejects null, malformed, or over-length values, never fabricates a
 * truncated/invented identity). If it is null or fails validation, the search continues to the
 * next-older candidate in the bounded window rather than producing absent/malformed threading
 * headers when a perfectly good earlier identity exists nearby. If NO candidate in the window has
 * a valid externalMessageId, In-Reply-To is simply omitted — never fabricated.
 */
export function deriveReplyThreadingHeaders(candidates: ReplyThreadingSource[]): ReplyThreadingHeaders {
  for (const candidate of candidates) {
    const validated = parsePrimaryMessageId(candidate.externalMessageId);
    if (!validated) continue;
    const priorTokens = parseMessageIdTokens(candidate.references);
    const tokens = [...priorTokens, validated];
    return { inReplyTo: validated, references: buildReferencesStorageValue(tokens, MAX_BODY_TEXT_BYTES) };
  }
  return { inReplyTo: null, references: undefined };
}
