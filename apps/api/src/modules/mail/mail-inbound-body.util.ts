/**
 * Slice C §5/§27 (hardened) — body extraction rules and a centralized, documented size bound.
 * Never executes or renders HTML; the HTML->text derivation below is pure string manipulation used
 * only to produce a safe plain-text fallback, never to reconstruct/serve HTML back to a UI.
 * Inbound email is untrusted input, so no remote resource (image, stylesheet, etc.) referenced by
 * HTML is ever fetched here or anywhere else in Slice C.
 *
 * CORRECTION PASS: EmailMessage.body_text and .body_html are both plain MariaDB `TEXT` columns
 * (see schema.prisma / the Slice A migration SQL), whose real storage limit is 65,535 BYTES, not
 * characters — the previous 200,000-CHARACTER limit here was unsafe (even pure ASCII content near
 * that length would exceed the column's actual byte capacity). Every bound below is now a UTF-8
 * BYTE limit, enforced with a truncation helper that never splits a multi-byte character.
 */

/** MariaDB TEXT column real maximum, in bytes (2^16 - 1). Never change this without also changing
 * the schema — it is a hard ceiling, not a policy choice. */
const MARIADB_TEXT_MAX_BYTES = 65_535;

/** Safety margin under the hard ceiling (~8%), applied uniformly to bodyText/bodyHtml/references —
 * leaves headroom rather than truncating at the exact byte edge. */
const SAFE_TEXT_BYTE_LIMIT = 60_000;

/** Applies to the persisted bodyText/bodyHtml columns, independent of the raw-message byte cap
 * enforced while streaming from IMAP (see MAX_INBOUND_MESSAGE_BYTES in imap-mailbox-reader.ts) —
 * this is a second, defense-in-depth bound against one pathologically large text/HTML part, sized
 * to actually fit the real `TEXT` column (see the module doc comment above). */
export const MAX_BODY_TEXT_BYTES = SAFE_TEXT_BYTE_LIMIT;

const TRUNCATION_MARKER = '\n[... truncated ...]';
const TRUNCATION_MARKER_BYTES = Buffer.byteLength(TRUNCATION_MARKER, 'utf8');

/**
 * Truncates a UTF-8 string to at most `maxBytes` bytes without ever splitting a multi-byte
 * character (surrogate-pair emoji, 2-byte Arabic/Latin-extended, 3-byte CJK, etc). Walks backward
 * from the byte cut point to find the start of the last — possibly incomplete — UTF-8 sequence and
 * drops it whole if it does not fully fit, rather than decoding a partial sequence.
 */
export function truncateUtf8Bytes(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return '';
  const buf = Buffer.from(value, 'utf8');
  if (buf.byteLength <= maxBytes) return value;

  let trailingContinuations = 0;
  let i = maxBytes - 1;
  while (i >= 0 && (buf[i]! & 0xc0) === 0x80) {
    trailingContinuations++;
    i--;
  }

  let cutIndex = maxBytes;
  if (i >= 0) {
    const leadByte = buf[i]!;
    let seqLen = 1;
    if ((leadByte & 0xe0) === 0xc0) seqLen = 2;
    else if ((leadByte & 0xf0) === 0xe0) seqLen = 3;
    else if ((leadByte & 0xf8) === 0xf0) seqLen = 4;
    const bytesPresent = trailingContinuations + 1;
    if (bytesPresent < seqLen) {
      cutIndex = i; // The sequence starting at `i` does not fully fit — drop it entirely.
    }
  }
  return buf.subarray(0, cutIndex).toString('utf8');
}

function boundBytes(value: string): string {
  if (Buffer.byteLength(value, 'utf8') <= SAFE_TEXT_BYTE_LIMIT) return value;
  const truncated = truncateUtf8Bytes(value, SAFE_TEXT_BYTE_LIMIT - TRUNCATION_MARKER_BYTES);
  return truncated + TRUNCATION_MARKER;
}

/**
 * Strips an HTML document down to safe, readable plain text: drops <script>/<style> content
 * entirely, converts block-level boundaries and <br> to newlines, strips every remaining tag, and
 * decodes only the small set of HTML entities that commonly appear in real mail. This is string
 * transformation only — no DOM, no execution, nothing is ever rendered.
 */
function htmlToSafePlainText(html: string): string {
  const withoutScriptsAndStyles = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '');
  const withNewlines = withoutScriptsAndStyles
    .replace(/<(br|br\/|br \/)>/gi, '\n')
    .replace(/<\/(p|div|tr|table|li|h[1-6])>/gi, '\n')
    .replace(/<(p|div|tr|li)[^>]*>/gi, '\n');
  const stripped = withNewlines.replace(/<[^>]+>/g, '');
  const decoded = stripped
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'");
  const trimmedLines = decoded
    .split('\n')
    .map((line) => line.trim())
    .join('\n');
  return trimmedLines.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Slice C §5: bodyText is required — use text/plain if the message has one; otherwise derive a
 * safe plain-text rendering from the HTML part; if neither is usable, an empty string is a
 * legitimate result (the caller must classify such a message HUMAN_REVIEW, never fail ingestion).
 */
export function deriveInboundBodyText(plainText: string | undefined, html: string | false | undefined): string {
  const trimmedPlain = plainText?.trim();
  if (trimmedPlain) return boundBytes(trimmedPlain);

  if (typeof html === 'string' && html.trim()) {
    const derived = htmlToSafePlainText(html);
    if (derived) return boundBytes(derived);
  }

  return '';
}

/** bodyHtml is optional and, per §5, stored only as an untrusted source — never rendered. */
export function deriveInboundBodyHtml(html: string | false | undefined): string | undefined {
  if (typeof html !== 'string' || !html.trim()) return undefined;
  return boundBytes(html);
}

export { MARIADB_TEXT_MAX_BYTES };
