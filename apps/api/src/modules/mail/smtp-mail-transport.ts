import { Injectable } from '@nestjs/common';
import { createTransport } from 'nodemailer';
import { SecretEncryptionService } from '../../security/secret-encryption.service';
import type { MailConfiguration } from '../../generated/prisma/client';
import { isMicrosoftOAuth2Credentials } from './microsoft-oauth-credentials';
import { MicrosoftOAuthTokenProvider } from './microsoft-oauth-token-provider';
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
 * Supports two decrypted-credential shapes (see smtp-credentials.ts): BASIC (unchanged — a plain
 * password) and MICROSOFT_OAUTH2 (a Microsoft Entra app-only access token resolved via
 * MicrosoftOAuthTokenProvider immediately before each send, never a password). Every existing
 * BASIC-configured MailConfiguration keeps behaving exactly as before this feature was added.
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

  constructor(
    private readonly encryption: SecretEncryptionService,
    // Defaulted (never NestJS-relevant — Nest always resolves and passes this explicitly, per
    // worker-app.module.ts) purely so every pre-existing BASIC-only test construction site
    // (`new SmtpMailTransport({ decrypt } as never)`) keeps compiling unchanged; those tests never
    // reach a MICROSOFT_OAUTH2 credential, so this default instance's real fetch is never invoked.
    private readonly oauthTokenProvider: MicrosoftOAuthTokenProvider = new MicrosoftOAuthTokenProvider(),
  ) {}

  async send(message: PreparedOutboundMessage, config: MailConfiguration): Promise<void> {
    const credentials = config.smtpCredentialsCiphertext
      ? this.encryption.decrypt<SmtpCredentials>(config.smtpCredentialsCiphertext)
      : undefined;
    const auth = await this.resolveAuth(config.smtpUsername, credentials);

    const transporter = this.transportFactory({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpSecure,
      auth,
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

  /** MICROSOFT_OAUTH2 credentials never reach nodemailer as a password — only a freshly resolved
   * access token, via nodemailer's documented "already have an access token" OAuth2 form (`type:
   * 'OAuth2', user, accessToken`, no clientId/clientSecret/refreshToken given), so nodemailer never
   * itself holds the client secret and never attempts its own token refresh; MicrosoftOAuthTokenProvider
   * remains the single place that ever contacts Microsoft's identity platform. */
  private async resolveAuth(
    username: string,
    credentials: SmtpCredentials | undefined,
  ): Promise<{ type: 'OAuth2'; user: string; accessToken: string } | { user: string; pass: string } | undefined> {
    if (!credentials) return undefined;
    if (isMicrosoftOAuth2Credentials(credentials)) {
      const accessToken = await this.oauthTokenProvider.getAccessToken(credentials);
      return { type: 'OAuth2', user: username, accessToken };
    }
    return { user: username, pass: credentials.password };
  }
}
