import type { MailConfiguration } from '../../generated/prisma/client';

/**
 * Slice C §3 — one clear MailboxReader abstraction, with a mock and a real IMAP implementation
 * (mock-mailbox-reader.ts / imap-mailbox-reader.ts). Neither implementation decides sync policy,
 * cursor advancement, dedup, or correlation — that is MailInboundIngestService's job exclusively;
 * a reader's only responsibility is "what is the mailbox's current state, and what messages exist
 * after this UID."
 */

export interface MailboxSyncState {
  uidValidity: bigint;
  /** The UID that will be assigned to the NEXT message to arrive — per RFC 3501, "highest UID in
   * the mailbox + 1" (0-message mailboxes still have a valid, non-zero-by-convention UIDNEXT). */
  uidNext: bigint;
}

export interface FetchedMailboxMessage {
  uid: bigint;
  /** Server-assigned receipt timestamp (IMAP INTERNALDATE) — Slice C §6 requires this, NEVER the
   * sender-controlled Date header, for EmailMessage.occurredAt. Undefined only in the documented
   * fallback case where a reader genuinely cannot obtain it. */
  internalDate: Date | undefined;
  subject: string | undefined;
  fromAddress: string | undefined;
  /** Raw address strings (already extracted from the To header), stored verbatim into
   * EmailMessage.toAddressesJson — never re-parsed downstream. */
  toAddresses: string[];
  messageIdHeader: string | undefined;
  inReplyToHeader: string | undefined;
  referencesHeader: string | undefined;
  /** Raw X-Renewal-Case-Id header value, if present — a correlation HINT only (§17), never treated
   * as authorization by anything downstream. */
  renewalCaseIdHeader: string | undefined;
  text: string | undefined;
  html: string | false | undefined;
  /** True when MIME parsing failed but enough raw metadata (at minimum the UID) was still
   * available to persist a minimal HUMAN_REVIEW EmailMessage per §26, instead of permanently
   * blocking the mailbox on one malformed message. When true, the other fields carry whatever
   * partial data could still be safely recovered (commonly none beyond uid/internalDate). */
  parseFailed: boolean;
}

export const MAILBOX_READER_FACTORY = Symbol('MAILBOX_READER_FACTORY');

/**
 * Mirrors Slice B's MAIL_TRANSPORT factory-provider pattern (mail.module.ts): one abstraction,
 * resolved to either a mock or a real implementation by a single factory provider keyed off
 * IMAP_MODE, so nothing downstream (MailInboundIngestService) needs to know which one it got.
 * Unlike MailTransport (stateless, one instance handles every send), a MailboxReader is scoped to
 * one MailConfiguration for one sync attempt — this factory's job is producing a fresh reader per
 * config, not being a reader itself.
 */
export interface MailboxReaderFactory {
  createReader(config: MailConfiguration): MailboxReader;
}

/**
 * Correction pass (protocol correctness) — the outcome of fetchMessagesSince(). A plain array
 * return could not distinguish "no new mail" from "the mailbox's identity changed out from under
 * us between the caller's last known UIDVALIDITY and this fetch" (a TOCTOU window if the caller
 * checked UIDVALIDITY via a separate getMailboxState() call beforehand). This type makes that
 * distinction load-bearing: a reader MUST check UIDVALIDITY itself, inside the very same mailbox
 * selection it uses for the fetch, and report a mismatch BEFORE fetching any message source.
 */
export type FetchSinceResult =
  | { outcome: 'ok'; messages: FetchedMailboxMessage[] }
  | { outcome: 'uidvalidity_changed'; currentUidValidity: bigint };

export interface MailboxReader {
  /** Opens/selects `folder` and returns its current UIDVALIDITY/UIDNEXT. Used only for the
   * UNINITIALIZED (bootstrap) cursor state, where there is no prior identity to defend — see
   * fetchMessagesSince for the ESTABLISHED-cursor path, which performs its own fresh identity
   * check rather than trusting a separate, earlier getMailboxState() call. */
  getMailboxState(folder: string): Promise<MailboxSyncState>;
  /**
   * Fetches messages with UID strictly greater than `afterUid` AND less than or equal to the
   * mailbox's current highest assigned UID (`uidNext - 1`), ascending order, at most `limit`
   * messages (bounded batch — Slice C §10, no unlimited backlog fetch per invocation). NEVER uses
   * an open-ended "highest UID" range — IMAP ranges are order-independent, so an open-ended upper
   * bound like "afterUid+1:*" would still match the mailbox's single highest-UID message even when
   * afterUid+1 is numerically greater than every existing UID, incorrectly re-returning historical
   * mail. The finite upper bound (`uidNext - 1`) must be computed from the SAME mailbox selection
   * used for the fetch itself, not a separately cached value.
   *
   * Before fetching any message source, the implementation MUST re-read the mailbox's current
   * UIDVALIDITY (from that same selection) and compare it against `expectedUidValidity`: a mismatch
   * returns `{outcome:'uidvalidity_changed', currentUidValidity}` immediately, fetching nothing —
   * this closes the check-then-fetch TOCTOU window a separate getMailboxState() call would leave
   * open. `{outcome:'ok', messages}` otherwise, with `messages` satisfying
   * `afterUid < uid <= (uidNext-1 at fetch time)` even if the underlying server/library behaves
   * unexpectedly (a defensive re-filter, not just a trusted range request).
   */
  fetchMessagesSince(
    folder: string,
    expectedUidValidity: bigint,
    afterUid: bigint,
    limit: number,
  ): Promise<FetchSinceResult>;
  /** Releases any underlying connection/resources. Must be idempotent and safe to call even if the
   * reader never successfully connected. */
  close(): Promise<void>;
}
