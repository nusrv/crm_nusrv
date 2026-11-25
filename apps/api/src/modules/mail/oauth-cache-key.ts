import { createHmac } from 'node:crypto';

/** Process-local cache identity, never persisted or logged. A replacement
 * secret must be tested with the identity provider, not a cached old token. */
export function oauthCacheKey(key: Buffer, credentials: { tenantId: string; clientId: string; clientSecret: string }): string {
  return createHmac('sha256', key).update(JSON.stringify([
    credentials.tenantId, credentials.clientId, credentials.clientSecret,
  ]), 'utf8').digest('hex');
}
