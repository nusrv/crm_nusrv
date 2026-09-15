import type { MailConfiguration } from '../../generated/prisma/client';

/**
 * A fully prepared outbound message. Every field is already resolved by the caller
 * (MailOutboundService) — a transport's only job is to hand this to a wire protocol. Neither
 * implementation may decide routing, retries, or eligibility; that is business logic that lives
 * upstream of this interface.
 */
export interface PreparedOutboundMessage {
  /** Stable Message-ID (angle-bracket wrapped, e.g. "<uuid@domain>"). Never regenerated on retry. */
  messageId: string;
  fromAddress: string;
  fromName: string;
  toAddress: string;
  subject: string;
  text: string;
  html?: string;
  /** Additional headers, e.g. X-Renewal-Case-Id. Never contains credentials. */
  headers?: Record<string, string>;
}

export const MAIL_TRANSPORT = Symbol('MAIL_TRANSPORT');

/**
 * One abstraction, two implementations (mock / real SMTP) — see mock-mail-transport.ts and
 * smtp-mail-transport.ts. The `config` argument carries the resolved MailConfiguration row
 * (still holding its encrypted credential ciphertext, never a decrypted secret) so a real
 * transport can decrypt lazily, at the last possible moment, and a mock transport never has to.
 */
export interface MailTransport {
  send(message: PreparedOutboundMessage, config: MailConfiguration): Promise<void>;
}
