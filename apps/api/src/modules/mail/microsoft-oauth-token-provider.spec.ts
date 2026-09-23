import { jest } from '@jest/globals';
import { MicrosoftOAuthTokenProvider } from './microsoft-oauth-token-provider';
import { MICROSOFT_OAUTH_TOKEN_SCOPE } from './microsoft-oauth.constants';

const CREDENTIALS = {
  authMode: 'MICROSOFT_OAUTH2' as const,
  tenantId: 'tenant-1',
  clientId: 'client-1',
  clientSecret: 'super-secret-client-secret',
};

function fakeFetchOnce(response: { ok: boolean; status?: number; json?: () => Promise<unknown> }) {
  return jest.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(() =>
    Promise.resolve({
      ok: response.ok,
      status: response.status ?? (response.ok ? 200 : 400),
      json: response.json ?? (() => Promise.resolve({})),
    } as Response),
  );
}

describe('MicrosoftOAuthTokenProvider', () => {
  it('requests a token from the Microsoft identity platform using client-credentials and the Exchange Online scope', async () => {
    const fetchImpl = fakeFetchOnce({ ok: true, json: () => Promise.resolve({ access_token: 'token-abc', expires_in: 3600 }) });
    const provider = new MicrosoftOAuthTokenProvider();
    provider.fetchImpl = fetchImpl;

    const token = await provider.getAccessToken(CREDENTIALS);

    expect(token).toBe('token-abc');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://login.microsoftonline.com/tenant-1/oauth2/v2.0/token');
    const initOptions = init as unknown as { method: string; body: string; headers: Record<string, string> };
    expect(initOptions.method).toBe('POST');
    expect(initOptions.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    const body = new URLSearchParams(initOptions.body);
    expect(body.get('grant_type')).toBe('client_credentials');
    expect(body.get('client_id')).toBe('client-1');
    expect(body.get('client_secret')).toBe('super-secret-client-secret');
    expect(body.get('scope')).toBe(MICROSOFT_OAUTH_TOKEN_SCOPE);
  });

  it('caches the access token in memory and does not request a new one before expiry', async () => {
    const fetchImpl = fakeFetchOnce({ ok: true, json: () => Promise.resolve({ access_token: 'token-abc', expires_in: 3600 }) });
    const provider = new MicrosoftOAuthTokenProvider();
    provider.fetchImpl = fetchImpl;

    const first = await provider.getAccessToken(CREDENTIALS);
    const second = await provider.getAccessToken(CREDENTIALS);

    expect(first).toBe('token-abc');
    expect(second).toBe('token-abc');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('requests a fresh token once the cached one is within its expiry skew', async () => {
    jest.useFakeTimers({ now: new Date('2026-01-01T00:00:00.000Z') });
    try {
      const fetchImpl = jest
        .fn()
        .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ access_token: 'token-1', expires_in: 60 }) } as never)
        .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ access_token: 'token-2', expires_in: 3600 }) } as never);
      const provider = new MicrosoftOAuthTokenProvider();
      provider.fetchImpl = fetchImpl as never;

      const first = await provider.getAccessToken(CREDENTIALS);
      // 60s lifetime, 60s refresh skew -> already stale immediately; advance past it defensively.
      jest.advanceTimersByTime(61_000);
      const second = await provider.getAccessToken(CREDENTIALS);

      expect(first).toBe('token-1');
      expect(second).toBe('token-2');
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('caches independently per (tenantId, clientId) pair', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ access_token: 'token-tenant-1', expires_in: 3600 }) } as never)
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ access_token: 'token-tenant-2', expires_in: 3600 }) } as never);
    const provider = new MicrosoftOAuthTokenProvider();
    provider.fetchImpl = fetchImpl as never;

    const tokenA = await provider.getAccessToken(CREDENTIALS);
    const tokenB = await provider.getAccessToken({ ...CREDENTIALS, tenantId: 'tenant-2' });

    expect(tokenA).toBe('token-tenant-1');
    expect(tokenB).toBe('token-tenant-2');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('never includes the client secret or an access token in a thrown error when the token endpoint rejects the request', async () => {
    const fetchImpl = fakeFetchOnce({ ok: false, status: 401 });
    const provider = new MicrosoftOAuthTokenProvider();
    provider.fetchImpl = fetchImpl;

    await expect(provider.getAccessToken(CREDENTIALS)).rejects.toThrow(/status 401/);
    try {
      await provider.getAccessToken(CREDENTIALS);
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toContain(CREDENTIALS.clientSecret);
    }
  });

  it('never includes the client secret in a thrown error on a network/timeout failure', async () => {
    const fetchImpl = jest.fn(() => Promise.reject(new Error('ECONNRESET: connection reset by peer')));
    const provider = new MicrosoftOAuthTokenProvider();
    provider.fetchImpl = fetchImpl;

    let thrown: Error | undefined;
    try {
      await provider.getAccessToken(CREDENTIALS);
    } catch (error) {
      thrown = error as Error;
    }

    expect(thrown).toBeDefined();
    expect(thrown!.message).not.toContain(CREDENTIALS.clientSecret);
    expect(thrown!.message).toContain('network error');
  });

  it('classifies an AbortError (bounded timeout) distinctly, still without leaking any secret', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    const fetchImpl = jest.fn(() => Promise.reject(abortError));
    const provider = new MicrosoftOAuthTokenProvider();
    provider.fetchImpl = fetchImpl;

    await expect(provider.getAccessToken(CREDENTIALS)).rejects.toThrow(/timeout/);
  });

  it('rejects a response that is missing an access token, without ever fabricating one', async () => {
    const fetchImpl = fakeFetchOnce({ ok: true, json: () => Promise.resolve({ expires_in: 3600 }) });
    const provider = new MicrosoftOAuthTokenProvider();
    provider.fetchImpl = fetchImpl;

    await expect(provider.getAccessToken(CREDENTIALS)).rejects.toThrow('did not include an access token');
  });

  it('falls back to a safe default lifetime when expires_in is absent or invalid', async () => {
    const fetchImpl = fakeFetchOnce({ ok: true, json: () => Promise.resolve({ access_token: 'token-xyz' }) });
    const provider = new MicrosoftOAuthTokenProvider();
    provider.fetchImpl = fetchImpl;

    const token = await provider.getAccessToken(CREDENTIALS);

    expect(token).toBe('token-xyz');
  });

  it('applies a bounded AbortSignal to every token request', async () => {
    const fetchImpl = fakeFetchOnce({ ok: true, json: () => Promise.resolve({ access_token: 'token-abc', expires_in: 3600 }) });
    const provider = new MicrosoftOAuthTokenProvider();
    provider.fetchImpl = fetchImpl;

    await provider.getAccessToken(CREDENTIALS);

    const [, init] = fetchImpl.mock.calls[0]!;
    expect((init as unknown as { signal?: AbortSignal }).signal).toBeInstanceOf(AbortSignal);
  });
});
