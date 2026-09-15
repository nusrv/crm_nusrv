import { Injectable } from '@nestjs/common';
import { createTransport } from 'nodemailer';
import { SecretEncryptionService } from '../../security/secret-encryption.service';
import type { MailConfiguration } from '../../generated/prisma/client';
import {
  SMTP_CONNECTION_TIMEOUT_MS,
  SMTP_GREETING_TIMEOUT_MS,
  SMTP_SOCKET_TIMEOUT_MS,
} from './mail-timing.constants';
import type { MailTransport, PreparedOutboundMessage } from './mail-transport';
import type { SmtpCredentials } from './smtp-credentials';

/**
 * Real SMTP delivery via nodemailer (the one dependency added for Slice B — see package.json).
 * Credentials are decrypted here, lazily, immediately before use, and never cached or logged —
 * MockMailTransport never reaches this code path at all. The caller (MailOutboundService) is
 * solely responsible for deciding whether this transport is even allowed to run
 * (MAIL_SEND_ENABLED, environment guard, cutover); this class performs no eligibility checks of
 * its own and unconditionally attempts to send whatever it is given.
 *
 * Timeouts are explicit, never nodemailer's undocumented/default values — see
 * mail-timing.constants.ts for why (the stale-PROCESSING reclaim lease depends on these being
 * bounded well below it).
 */
@Injectable()
export class SmtpMailTransport implements MailTransport {
  /**
   * Test seam only — defaults to the real nodemailer factory in production. Overriding this
   * property lets tests substitute a fake transporter without module-level mocking, which does
   * not fit this project's CJS/NodeNext TypeScript configuration (see smtp-mail-transport.spec.ts).
   */
  transportFactory: typeof createTransport = createTransport;

  constructor(private readonly encryption: SecretEncryptionService) {}

  async send(message: PreparedOutboundMessage, config: MailConfiguration): Promise<void> {
    const password = config.smtpCredentialsCiphertext
      ? this.encryption.decrypt<SmtpCredentials>(config.smtpCredentialsCiphertext).password
      : undefined;

    const transporter = this.transportFactory({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpSecure,
      auth: password ? { user: config.smtpUsername, pass: password } : undefined,
      connectionTimeout: SMTP_CONNECTION_TIMEOUT_MS,
      greetingTimeout: SMTP_GREETING_TIMEOUT_MS,
      socketTimeout: SMTP_SOCKET_TIMEOUT_MS,
    });

    try {
      await transporter.sendMail({
        messageId: message.messageId,
        from: { name: message.fromName, address: message.fromAddress },
        to: message.toAddress,
        subject: message.subject,
        text: message.text,
        html: message.html,
        headers: message.headers,
      });
    } finally {
      transporter.close();
    }
  }
}
