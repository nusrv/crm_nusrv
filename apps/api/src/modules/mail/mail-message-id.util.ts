import { randomUUID } from 'node:crypto';

/**
 * Stable, RFC 5322-shaped Message-ID generation — see CommunicationOutbox.messageIdHeader /
 * EmailMessage.externalMessageId. Generated exactly once per outbound message, at first
 * materialization, and reused verbatim on every retry (never regenerated). Contains no secrets
 * and no customer PII: only a random UUID local part and the sending domain.
 */
export function generateStableMessageId(fromAddress: string): string {
  const atIndex = fromAddress.indexOf('@');
  const domain = atIndex >= 0 ? fromAddress.slice(atIndex + 1) : 'localhost';
  return `<${randomUUID()}@${domain}>`;
}
