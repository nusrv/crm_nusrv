import type { MicrosoftOAuth2Credentials } from './microsoft-oauth-credentials';

/**
 * Runtime contract for MailConfiguration.smtpCredentialsCiphertext (Slice B §7/§25): the envelope
 * decrypts, via the existing SecretEncryptionService (the same primitive TechnicalConnectionSecretService
 * already uses — no second cryptography system), to one of these two shapes. `authMode` is optional
 * and defaults to BASIC — every envelope created before Microsoft OAuth2 support existed decrypts to
 * `{ password }` with no `authMode` field at all, and remains valid, unchanged, BASIC forever.
 */
export interface BasicSmtpCredentials {
  authMode?: 'BASIC';
  /** The SMTP AUTH secret; nothing else is ever stored in this shape's envelope. */
  password: string;
}

export type SmtpCredentials = BasicSmtpCredentials | MicrosoftOAuth2Credentials;
