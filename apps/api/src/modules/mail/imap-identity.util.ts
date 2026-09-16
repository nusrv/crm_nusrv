import { createHash } from 'node:crypto';

/**
 * Slice C implementation of the FROZEN identity contract documented on
 * EmailMessage.imapIdentityKey in schema.prisma (Slice A). Do not alter this algorithm — it is a
 * persistence contract; changing it would silently break dedup for every previously-ingested row.
 * A future incompatible change must introduce a new version prefix (e.g. "v2:"), never mutate "v1:".
 *
 * canonicalFolder rule (frozen, schema.prisma comment): the exact persisted IMAP folder name is
 * used as-is — no trim, no lowercasing, no Unicode normalization — with exactly one exception: a
 * mailbox name that case-insensitively equals "INBOX" (per RFC 3501) canonicalizes to the literal
 * string "INBOX". Every other folder name, including ones differing only by case, is a distinct
 * canonicalFolder value.
 */
export function canonicalizeImapFolder(rawFolderName: string): string {
  return rawFolderName.toUpperCase() === 'INBOX' ? 'INBOX' : rawFolderName;
}

/**
 * Netstring-style, length-prefixed encoding of a single component: `<utf8ByteLength>:<value>`.
 * The length prefix is itself the delimiter, so no component's content (which could legally
 * contain any character, including one that would otherwise be used as a separator) can ever
 * produce an ambiguous/colliding encoding. Length is the UTF-8 BYTE length, not the JS string
 * character length, per the frozen schema.prisma contract.
 */
function encodeComponent(value: string): string {
  return `${Buffer.byteLength(value, 'utf8')}:${value}`;
}

export interface ImapIdentityTuple {
  mailConfigurationId: string;
  canonicalFolder: string;
  uidValidity: bigint;
  uid: bigint;
}

/** Exposed only for the direct contract tests — production code should call computeImapIdentityKey. */
export function canonicalImapIdentityEncoding(tuple: ImapIdentityTuple): string {
  return (
    encodeComponent(tuple.mailConfigurationId) +
    encodeComponent(tuple.canonicalFolder) +
    encodeComponent(tuple.uidValidity.toString()) +
    encodeComponent(tuple.uid.toString())
  );
}

/**
 * `imapIdentityKey = "v1:" + lowercase_sha256_hex(canonicalEncoding(tuple))` — always exactly 67
 * characters (`v1:` + 64 hex chars). This is the sole authoritative inbound dedup key (Slice C
 * §8) — never externalMessageId, and never computed from client input.
 */
export function computeImapIdentityKey(tuple: ImapIdentityTuple): string {
  const digest = createHash('sha256').update(canonicalImapIdentityEncoding(tuple), 'utf8').digest('hex');
  return `v1:${digest}`;
}
