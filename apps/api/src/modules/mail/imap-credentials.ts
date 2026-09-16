/**
 * Runtime contract for MailConfiguration.imapCredentialsCiphertext (Slice C), decrypted via the
 * existing SecretEncryptionService — the same primitive smtp-credentials.ts already uses for the
 * SMTP side of the same row. `password` is the IMAP AUTH secret; nothing else is ever stored in
 * this envelope.
 */
export interface ImapCredentials {
  password: string;
}
