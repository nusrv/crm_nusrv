import { Injectable } from '@nestjs/common';
import type { MicrosoftOAuth2Credentials } from './microsoft-oauth-credentials';
import {
  MICROSOFT_OAUTH_TOKEN_REFRESH_SKEW_MS,
  MICROSOFT_OAUTH_TOKEN_SCOPE,
  MICROSOFT_OAUTH_TOKEN_TIMEOUT_MS,
} from './microsoft-oauth.constants';

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

/**
 * Server-side Microsoft Entra client-credentials (app-only) token acquisition for IMAP/SMTP OAuth2
 * (XOAUTH2) against Exchange Online — narrowly scoped to exactly this one grant type/resource, never
 * a general-purpose Graph client and never a Graph API call of any kind.
 *
 * Access tokens are cached ONLY in memory, per (tenantId, clientId), for at most their own
 * server-declared lifetime minus a safety skew — never persisted to the database, never logged, and
 * never included in a thrown error. SmtpMailTransport/ImapMailboxReader call getAccessToken()
 * immediately before use, exactly mirroring how they already decrypt the BASIC `password` field
 * lazily immediately before use; this class performs no eligibility/mode checks of its own — it is
 * only ever reached once a caller has already decided the configuration is MICROSOFT_OAUTH2, so no
 * token request happens while a MailConfiguration is on BASIC auth or while SMTP_MODE/IMAP_MODE is
 * `mock` (see worker-app.module.ts's mock/real transport-and-reader factory selection).
 */
@Injectable()
export class MicrosoftOAuthTokenProvider {
  /** Test seam only — mirrors SmtpMailTransport.transportFactory / ImapMailboxReader.clientFactory.
   * Defaults to the real global fetch in production. */
  fetchImpl: typeof fetch = fetch;

  private readonly cache = new Map<string, CachedToken>();

  async getAccessToken(credentials: MicrosoftOAuth2Credentials): Promise<string> {
    const cacheKey = `${credentials.tenantId}:${credentials.clientId}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt - MICROSOFT_OAUTH_TOKEN_REFRESH_SKEW_MS > Date.now()) {
      return cached.accessToken;
    }

    const token = await this.requestToken(credentials);
    this.cache.set(cacheKey, token);
    return token.accessToken;
  }

  private async requestToken(credentials: MicrosoftOAuth2Credentials): Promise<CachedToken> {
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      scope: MICROSOFT_OAUTH_TOKEN_SCOPE,
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), MICROSOFT_OAUTH_TOKEN_TIMEOUT_MS);
    let response: Response;
    try {
      response = await this.fetchImpl(
        `https://login.microsoftonline.com/${encodeURIComponent(credentials.tenantId)}/oauth2/v2.0/token`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
          signal: controller.signal,
        },
      );
    } catch (error) {
      // Never the raw error (may embed request internals) and never the request body — sanitized,
      // fixed message only. `error.name === 'AbortError'` is the one detail worth distinguishing
      // (timeout vs. any other network failure); nothing about credentials ever crosses this line.
      const timedOut = error instanceof Error && error.name === 'AbortError';
      throw new Error(`Microsoft OAuth token request failed (${timedOut ? 'timeout' : 'network error'}).`);
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      // Microsoft's token error response body may itself echo request parameters back — never
      // parsed or logged; only the safe HTTP status crosses this boundary (mirrors
      // OpenAiProviderAdapter's SafeProviderErrorContext / llm-http-error.util.ts discipline for the
      // same reason).
      throw new Error(`Microsoft OAuth token request rejected (status ${response.status}).`);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new Error('Microsoft OAuth token response was not valid JSON.');
    }

    const parsed = payload as { access_token?: unknown; expires_in?: unknown };
    if (typeof parsed.access_token !== 'string' || parsed.access_token.length === 0) {
      throw new Error('Microsoft OAuth token response did not include an access token.');
    }
    const expiresInSeconds = typeof parsed.expires_in === 'number' && parsed.expires_in > 0 ? parsed.expires_in : 3600;

    return { accessToken: parsed.access_token, expiresAt: Date.now() + expiresInSeconds * 1000 };
  }
}
