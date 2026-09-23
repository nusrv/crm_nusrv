/** Bounded network timeout for a Microsoft Entra client-credentials token request — mirrors the
 * existing SMTP/IMAP/AI-provider timeout constants' own rationale (never rely on an undocumented
 * library/fetch default). */
export const MICROSOFT_OAUTH_TOKEN_TIMEOUT_MS = 10_000;

/** A cached access token is treated as expired this far ahead of its server-declared expiry, so a
 * connection attempt never starts with a token that expires mid-handshake. */
export const MICROSOFT_OAUTH_TOKEN_REFRESH_SKEW_MS = 60_000;

/** The resource/scope Microsoft's identity platform requires for app-only (client-credentials)
 * OAuth2 authentication of IMAP/SMTP/POP against Exchange Online — never a Microsoft Graph scope
 * (this task explicitly does not add a Graph client). */
export const MICROSOFT_OAUTH_TOKEN_SCOPE = 'https://outlook.office365.com/.default';
