/**
 * Shared Microsoft Entra client-credentials (app-only) shape. Embedded directly inside the SAME
 * encrypted envelope SmtpCredentials/ImapCredentials already occupy on MailConfiguration
 * (smtp_credentials_ciphertext / imap_credentials_ciphertext) — no new Prisma column, no new
 * ciphertext field, no schema migration. `authMode` is the discriminant SmtpMailTransport /
 * ImapMailboxReader read immediately after decrypting to decide BASIC vs MICROSOFT_OAUTH2; a
 * decrypted envelope with no `authMode` at all is treated as BASIC (backward-compatible with every
 * credential envelope created before this feature existed).
 *
 * `clientSecret` lives here only in the same encrypted-at-rest, decrypted-lazily-immediately-before-
 * use form the existing `password` field already followed — never logged, never persisted anywhere
 * else, never included in an error.
 */
export interface MicrosoftOAuth2Credentials {
  authMode: 'MICROSOFT_OAUTH2';
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

export function isMicrosoftOAuth2Credentials(value: { authMode?: string }): value is MicrosoftOAuth2Credentials {
  return value.authMode === 'MICROSOFT_OAUTH2';
}
