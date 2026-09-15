/**
 * Centralized SMTP/claim timing constants (Slice B hardening pass). These encode ONE invariant,
 * enforced by construction (both SmtpMailTransport and MailOutboundService import from here —
 * neither re-declares its own number) and verified by mail-timing.constants.spec.ts:
 *
 *   SMTP_TIMEOUT_BUDGET_MS < STALE_PROCESSING_LEASE_MS, with a meaningful safety margin.
 *
 * Why this matters: a healthy worker still legitimately inside transport.send() should not
 * normally have its claimed row reclaimed by a second worker while the first is still working it.
 * A stable Message-ID does NOT protect against that on its own; it only lets a legitimate,
 * sequential retry reuse the same identity.
 *
 * IMPORTANT — this timing margin is a defense-in-depth measure, NOT the correctness mechanism.
 * `SMTP_TIMEOUT_BUDGET_MS` is a CONFIGURED TIMEOUT BUDGET / expected upper bound for a normal SMTP
 * exchange — it sums the three phase timeouts as if they were additive worst-case durations, which
 * is already an approximation: nodemailer's `socketTimeout` is inactivity-based (it resets on any
 * socket activity, not a hard cap on total connection duration), so it is NOT a guaranteed
 * wall-clock maximum a pathological, slowly-but-continuously-active connection could never exceed.
 * Do not treat it as one.
 *
 * The actual correctness guarantee against two workers concurrently transmitting for the same
 * logical message comes from the ownership-token compare-and-swap in MailOutboundService (the
 * exact `lastAttemptAt` value persisted by a successful claim, required by every subsequent
 * PROCESSING-state mutation) — see that file's lease-ownership doc comment. This timing margin
 * exists only to make a stale-reclaim race rare in the first place, reducing how often the CAS
 * guard actually has to reject a stale worker's write; it is not what makes that rejection safe.
 * No lease-heartbeat/renewal system exists in this slice — the claim token is established once and
 * held for the whole processing attempt (see MailOutboundService).
 *
 * This is separate from, and does not change, the separately-documented irreducible risk of SMTP
 * accepting a message before the DB can record success/failure (see MailOutboundService's delivery-
 * model doc comment) — the ownership CAS prevents two workers from overlapping, it cannot undo an
 * external SMTP side effect a worker already triggered before it discovered it had lost ownership.
 */
export const SMTP_CONNECTION_TIMEOUT_MS = 30_000; // 30s to establish the TCP/TLS connection.
export const SMTP_GREETING_TIMEOUT_MS = 30_000; // 30s to receive the server's initial greeting.
export const SMTP_SOCKET_TIMEOUT_MS = 120_000; // 2 minutes of socket inactivity during the dialogue.

export const SMTP_TIMEOUT_BUDGET_MS =
  SMTP_CONNECTION_TIMEOUT_MS + SMTP_GREETING_TIMEOUT_MS + SMTP_SOCKET_TIMEOUT_MS; // 3 minutes.

export const STALE_PROCESSING_LEASE_MS = 10 * 60 * 1000; // 10 minutes — 7 minutes of margin over SMTP_TIMEOUT_BUDGET_MS.
