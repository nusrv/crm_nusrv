/**
 * Distinguishes an infrastructure/configuration/transport problem (which may legitimately affect
 * MailConfiguration health) from a message/recipient-specific rejection (which must only affect
 * that one outbox row — one bad recipient must never mark the whole mailbox UNAVAILABLE). Built on
 * the smallest robust subset of nodemailer's actual error shape: `code`, `command`, and
 * `responseCode` (the parsed 3-digit SMTP reply code).
 *
 * `terminal: true` means "do not consume the remaining retry budget — fail this row now,"
 * regardless of MAX_SEND_ATTEMPTS. `healthImpact` has three values:
 *   - 'infrastructure': the existing DEGRADED/UNAVAILABLE signal applies.
 *   - 'message':         never touch MailConfiguration health — this is about one recipient/message.
 *   - 'none':             insufficient evidence to conclude anything about health either way.
 *
 * EXPLICIT PRECEDENCE (checked in this order — do not reorder; a later rule never overrides an
 * earlier one):
 *
 *   A. Connection/auth/DNS/TLS/socket failure -> infrastructure, ALWAYS, regardless of whatever
 *      responseCode happens to be attached. This is the rule the others exist to not violate: an
 *      auth failure can carry a 5xx-looking responseCode (e.g. EAUTH + responseCode 535) and must
 *      never be reclassified as a message-specific rejection merely because that number looks like
 *      one — that reclassification is exactly the ambiguity this precedence exists to remove.
 *   B. RCPT TO (recipient-stage) response, once (A) has already ruled out an infra cause:
 *        5xx -> permanent, message-specific, terminal, no health impact.
 *        4xx -> temporary, message-specific, bounded retry, no health impact (one recipient's
 *               temporary trouble must not mark the whole mailbox unhealthy).
 *   C. DATA (message-content) stage, once (A) has already ruled out an infra cause:
 *        5xx -> permanent, message-specific, terminal, no health impact.
 *   D. MAIL FROM (sender/envelope) stage, once (A) has already ruled out an infra cause:
 *        5xx -> a permanent sender rejection reflects OUR sending identity/configuration, not the
 *               recipient — infrastructure health impact, but not immediately terminal (a config
 *               fix may let a later bounded retry succeed).
 *   E. Anything else (nodemailer's own envelope/message validation errors, or a genuinely
 *      unclassifiable shape) -> fail safely: bounded retry, no unjustified health conclusion
 *      ('none') — EXCEPT EENVELOPE/EMESSAGE, which nodemailer raises for a message that could never
 *      be sent as constructed (no SMTP round trip involved at all), so those are message-specific
 *      and terminal like a permanent RCPT/DATA rejection.
 */
export interface SmtpErrorClassification {
  terminal: boolean;
  healthImpact: 'infrastructure' | 'message' | 'none';
}

interface SmtpLikeError {
  code?: string;
  command?: string;
  responseCode?: number;
}

const INFRASTRUCTURE_CODES = new Set([
  'EAUTH',
  'ECONNECTION',
  'ESOCKET',
  'ETIMEDOUT',
  'EDNS',
  'ECONNRESET',
  'ETLS',
]);

function isPermanent(responseCode: number | undefined): boolean {
  return typeof responseCode === 'number' && responseCode >= 500 && responseCode < 600;
}

function isTransient(responseCode: number | undefined): boolean {
  return typeof responseCode === 'number' && responseCode >= 400 && responseCode < 500;
}

export function classifySmtpError(error: unknown): SmtpErrorClassification {
  const candidate = (typeof error === 'object' && error !== null ? error : {}) as SmtpLikeError;
  const { code, command, responseCode } = candidate;
  const stage = command?.toUpperCase();

  // A. Wins over everything below, unconditionally.
  if ((code && INFRASTRUCTURE_CODES.has(code)) || stage === 'CONN' || stage === 'AUTH') {
    return { terminal: false, healthImpact: 'infrastructure' };
  }

  // B. RCPT TO.
  if (stage?.startsWith('RCPT')) {
    if (isPermanent(responseCode)) return { terminal: true, healthImpact: 'message' };
    if (isTransient(responseCode)) return { terminal: false, healthImpact: 'message' };
  }

  // C. DATA.
  if (stage?.startsWith('DATA') && isPermanent(responseCode)) {
    return { terminal: true, healthImpact: 'message' };
  }

  // D. MAIL FROM.
  if (stage?.startsWith('MAIL') && isPermanent(responseCode)) {
    return { terminal: false, healthImpact: 'infrastructure' };
  }

  // E. Nodemailer's own envelope/message-shape validation errors.
  if (code === 'EENVELOPE' || code === 'EMESSAGE') {
    return { terminal: true, healthImpact: 'message' };
  }

  // E. Everything else: fail safely.
  return { terminal: false, healthImpact: 'none' };
}
