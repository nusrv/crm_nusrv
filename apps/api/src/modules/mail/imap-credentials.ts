import type { MicrosoftOAuth2Credentials } from './microsoft-oauth-credentials';

/**
 * Runtime contract for MailConfiguration.imapCredentialsCiphertext (Slice C), decrypted via the
 * existing SecretEncryptionService — the same primitive smtp-credentials.ts already uses for the
 * SMTP side of the same row. Decrypts to one of these two shapes; `authMode` is optional and
 * defaults to BASIC — every envelope created before Microsoft OAuth2 support existed decrypts to
 * `{ password }` with no `authMode` field at all, and remains valid, unchanged, BASIC forever.
 */
export interface BasicImapCredentials {
  authMode?: 'BASIC';
  /** The IMAP AUTH secret; nothing else is ever stored in this shape's envelope. */
  password: string;
}

export type ImapCredentials = BasicImapCredentials | MicrosoftOAuth2Credentials;
