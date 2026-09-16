/**
 * Slice C — centralized IMAP timing/size constants, mirroring the spirit of
 * mail-timing.constants.ts (Slice B) for the inbound side. There is no lease/CAS timing margin to
 * maintain here (IMAP sync has no analogous stale-PROCESSING reclaim window — a sync run either
 * completes or the next scheduled tick simply tries again), so these exist purely to give
 * nodemailer's IMAP counterpart (ImapFlow) explicit, bounded timeouts instead of its defaults, and
 * to give the reader/parser layer one documented size ceiling instead of an implicit one.
 */
export const IMAP_CONNECTION_TIMEOUT_MS = 30_000; // 30s to establish the TCP/TLS connection.
export const IMAP_GREETING_TIMEOUT_MS = 30_000; // 30s to receive the server's initial greeting.
export const IMAP_SOCKET_TIMEOUT_MS = 120_000; // 2 minutes of socket inactivity during the session.

/**
 * Slice C §27 — a message's raw RFC822 source is never buffered past this many bytes. ImapFlow's
 * `download`/`fetch(..., {source: {maxLength}})` truncates server-side at this many bytes rather
 * than the client ever holding more in memory; a message this large is parsed only as far as the
 * truncated bytes allow (commonly still enough for headers + partial body), and if that partial
 * source fails to parse at all, the reader falls back to a minimal record (§26) rather than
 * blocking the mailbox. No attachment content is ever persisted regardless of message size (§4).
 */
export const MAX_INBOUND_MESSAGE_BYTES = 10 * 1024 * 1024; // 10 MB.

/** Slice C §10 — bounded batch size per sync invocation; no unlimited backlog fetch. */
export const DEFAULT_IMAP_SYNC_BATCH_SIZE = 100;
