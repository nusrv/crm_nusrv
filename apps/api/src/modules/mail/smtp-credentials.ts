/**
 * Runtime contract for MailConfiguration.smtpCredentialsCiphertext (Slice B §7/§25): the envelope
 * decrypts, via the existing SecretEncryptionService (the same primitive TechnicalConnectionSecretService
 * already uses — no second cryptography system), to exactly this shape. `password` is the SMTP
 * AUTH secret; nothing else is ever stored in this envelope.
 */
export interface SmtpCredentials {
  password: string;
}
