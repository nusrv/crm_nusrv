import { jest } from '@jest/globals';
import { ImapMailboxReader } from './imap-mailbox-reader';
import { IMAP_CONNECTION_TIMEOUT_MS, IMAP_GREETING_TIMEOUT_MS, IMAP_SOCKET_TIMEOUT_MS, MAX_INBOUND_MESSAGE_BYTES } from './imap-timing.constants';

const REAL_PASSWORD = 'super-secret-imap-password';

interface FakeFetchMessage {
  uid: number;
  internalDate?: Date;
  source?: Buffer;
}

function fakeClient(options: { fetchMessages?: FakeFetchMessage[]; uidValidity?: bigint; uidNext?: number } = {}) {
  const connect = jest.fn(() => Promise.resolve());
  const logout = jest.fn(() => Promise.resolve());
  const close = jest.fn();
  const release = jest.fn();
  const getMailboxLock = jest.fn((path: string) => {
    void path;
    return Promise.resolve({ path, release });
  });
  const mailbox = { uidValidity: options.uidValidity ?? 7n, uidNext: options.uidNext ?? 200 };
  const fetchCalls: unknown[][] = [];
  async function* fetchGenerator() {
    for (const message of options.fetchMessages ?? []) {
      await Promise.resolve();
      yield message;
    }
  }
  const fetch = jest.fn((...args: unknown[]) => {
    fetchCalls.push(args);
    return fetchGenerator();
  });
  const client = { connect, logout, close, getMailboxLock, mailbox, fetch };
  return { client, connect, logout, close, release, getMailboxLock, fetch, fetchCalls };
}

function fakeEncryption(password = REAL_PASSWORD) {
  const decrypt = jest.fn(() => ({ password }));
  return { decrypt };
}

function fakeConfig(overrides: Record<string, unknown> = {}) {
  return {
    id: 'config-1',
    enabled: true,
    imapHost: 'imap.example.test',
    imapPort: 993,
    imapUsername: 'user@example.test',
    imapSecure: true,
    imapCredentialsCiphertext: 'ciphertext-blob',
    ...overrides,
  };
}

/** Unwraps a successful {outcome:'ok', messages} result, failing loudly if the fetch instead
 * reported a uidvalidity_changed outcome — keeps the bulk of the existing tests focused on their
 * own concern rather than re-asserting the outcome discriminant every time. */
function expectOk(result: { outcome: string; messages?: unknown }) {
  if (result.outcome !== 'ok') {
    throw new Error(`expected outcome 'ok', got '${result.outcome}'`);
  }
  return result.messages as { uid: bigint; subject?: string; internalDate?: Date; parseFailed: boolean }[];
}

describe('ImapMailboxReader (adapter contract, mocked ImapFlow/mailparser boundary)', () => {
  it('refuses Sent discovery for a disabled mailbox before opening a connection', async () => {
    const reader = new ImapMailboxReader(fakeConfig({ enabled: false }) as never, fakeEncryption() as never);
    const connect = jest.fn(() => { throw new Error('unexpected connection'); });
    reader.clientFactory = connect;
    expect(await reader.discoverSentFolder()).toEqual({ outcome: 'NOT_ENABLED' });
    expect(connect).not.toHaveBeenCalled();
  });

  it('probes server Sent flags through LIST without selecting or fetching a folder', async () => {
    const { client, fetch, getMailboxLock } = fakeClient();
    const list = jest.fn(() => Promise.resolve([{ path: 'Outbox/Sent copies', listed: true, flags: new Set(['\\Sent']) }]));
    const reader = new ImapMailboxReader(fakeConfig() as never, fakeEncryption() as never);
    reader.clientFactory = () => ({ ...client, list }) as never;

    expect(await reader.discoverSentFolder()).toMatchObject({
      outcome: 'AVAILABLE', folder: { mailConfigurationId: 'config-1', folderName: 'Outbox/Sent copies' },
    });
    expect(list).toHaveBeenCalledWith({ listOnly: true });
    expect(getMailboxLock).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    await reader.close();
  });

  it('binds baseline state to a fresh discovery and a read-only selection of the requested folder', async () => {
    const { client, getMailboxLock, fetch } = fakeClient();
    const list = jest.fn(() => Promise.resolve([{ path: 'Folder/Sent', listed: true, flags: new Set(['\\Sent']) }]));
    const reader = new ImapMailboxReader(fakeConfig() as never, fakeEncryption() as never);
    reader.clientFactory = () => ({ ...client, list }) as never;

    expect(await reader.readSentBaselineSource('folder/sent')).toBeNull();
    expect(getMailboxLock).not.toHaveBeenCalled();
    expect(await reader.readSentBaselineSource('Folder/Sent')).toMatchObject({
      mailConfigurationId: 'config-1', folderName: 'Folder/Sent', uidValidity: 7n, uidNext: 200n,
    });
    expect(getMailboxLock).toHaveBeenCalledWith('Folder/Sent', { readOnly: true });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('selects the lowest Sent UIDs before fetching and accepts an out-of-order exact result', async () => {
    const { client, fetchCalls, getMailboxLock } = fakeClient({
      uidNext: 500, fetchMessages: [{ uid: 350 }, { uid: 20 }],
    });
    const search = jest.fn<() => Promise<{ count: number; min: number }>>()
      .mockResolvedValueOnce({ count: 3, min: 20 })
      .mockResolvedValueOnce({ count: 2, min: 350 });
    const reader = new ImapMailboxReader(fakeConfig() as never, fakeEncryption() as never);
    reader.clientFactory = () => ({ ...client, capabilities: new Map([['ESEARCH', true]]), search }) as never;

    expect(expectOk(await reader.fetchSentMessagesSince('Sent Items', 7n, 10n, 2)).map((row) => row.uid))
      .toEqual([20n, 350n]);
    expect(getMailboxLock).toHaveBeenCalledWith('Sent Items', { readOnly: true });
    expect(search).toHaveBeenNthCalledWith(1, { uid: '11:499' }, { uid: true, returnOptions: ['MIN', 'COUNT'] });
    expect(search).toHaveBeenNthCalledWith(2, { uid: '21:499' }, { uid: true, returnOptions: ['MIN', 'COUNT'] });
    expect(search).toHaveBeenCalledTimes(2);
    expect(fetchCalls[0]?.[0]).toBe('20,350');
  });

  it('does not fetch a Sent message without a bounded search capability or with a stale epoch', async () => {
    const { client, fetch, getMailboxLock } = fakeClient();
    const search = jest.fn();
    const capabilities = new Map<string, boolean>();
    const reader = new ImapMailboxReader(fakeConfig() as never, fakeEncryption() as never);
    reader.clientFactory = () => ({ ...client, capabilities, search }) as never;

    expect(await reader.fetchSentMessagesSince('Sent', 7n, 5n, 10)).toEqual({ outcome: 'bounded_search_unavailable' });
    expect(getMailboxLock).not.toHaveBeenCalled();
    capabilities.set('ESEARCH', true);
    expect(await reader.fetchSentMessagesSince('Sent', 8n, 5n, 10))
      .toEqual({ outcome: 'uidvalidity_changed', currentUidValidity: 7n });
    expect(search).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([[[]], [[{ uid: 60 }]], [[{ uid: 20 }, { uid: 20 }]]])(
    'discards the whole Sent result when FETCH omits, substitutes or duplicates a selected UID (%j)',
    async (fetchMessages) => {
      const { client } = fakeClient({ fetchMessages });
      const reader = new ImapMailboxReader(fakeConfig() as never, fakeEncryption() as never);
      const search = jest.fn(() => Promise.resolve({ count: 1, min: 20 }));
      reader.clientFactory = () => ({ ...client, capabilities: new Map([['ESEARCH', true]]), search }) as never;
      expect(await reader.fetchSentMessagesSince('Sent', 7n, 10n, 2)).toEqual({ outcome: 'integrity_error' });
    },
  );

  it('refuses a legacy unbounded search result even if the server advertised ESEARCH', async () => {
    const { client, fetch } = fakeClient();
    const reader = new ImapMailboxReader(fakeConfig() as never, fakeEncryption() as never);
    const search = jest.fn(() => Promise.resolve([20, 25]));
    reader.clientFactory = () => ({ ...client, capabilities: new Map([['ESEARCH', true]]), search }) as never;
    expect(await reader.fetchSentMessagesSince('Sent', 7n, 10n, 2)).toEqual({ outcome: 'integrity_error' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('never decrypts credentials until a real connection is actually opened', () => {
    const encryption = fakeEncryption();
    new ImapMailboxReader(fakeConfig() as never, encryption as never);
    expect(encryption.decrypt).not.toHaveBeenCalled();
  });

  it('decrypts credentials exactly once, lazily, on first connection attempt', async () => {
    const { client } = fakeClient();
    const encryption = fakeEncryption();
    const reader = new ImapMailboxReader(fakeConfig() as never, encryption as never);
    reader.clientFactory = () => client as never;

    await reader.getMailboxState('INBOX');
    await reader.fetchMessagesSince('INBOX', 7n, 0n, 10);

    expect(encryption.decrypt).toHaveBeenCalledTimes(1);
  });

  it('never constructs ImapFlow without decrypting first when a credential ciphertext exists', async () => {
    const { client } = fakeClient();
    const encryption = fakeEncryption();
    const reader = new ImapMailboxReader(fakeConfig() as never, encryption as never);
    let factoryCallOrder = 0;
    let decryptCallOrder = 0;
    let counter = 0;
    encryption.decrypt.mockImplementation(() => {
      decryptCallOrder = ++counter;
      return { password: REAL_PASSWORD };
    });
    reader.clientFactory = () => {
      factoryCallOrder = ++counter;
      return client as never;
    };

    await reader.getMailboxState('INBOX');
    expect(decryptCallOrder).toBeLessThan(factoryCallOrder);
  });

  it('constructs ImapFlow with the exact configured host/port/secure/auth and bounded timeouts', async () => {
    const { client } = fakeClient();
    const encryption = fakeEncryption();
    const reader = new ImapMailboxReader(
      fakeConfig({ imapHost: 'mail.acme.test', imapPort: 1993, imapUsername: 'acme@example.test', imapSecure: false }) as never,
      encryption as never,
    );
    let capturedOptions: Record<string, unknown> | undefined;
    reader.clientFactory = (options) => {
      capturedOptions = options as never;
      return client as never;
    };

    await reader.getMailboxState('INBOX');

    expect(capturedOptions).toMatchObject({
      host: 'mail.acme.test',
      port: 1993,
      secure: false,
      auth: { user: 'acme@example.test', pass: REAL_PASSWORD },
      connectionTimeout: IMAP_CONNECTION_TIMEOUT_MS,
      greetingTimeout: IMAP_GREETING_TIMEOUT_MS,
      socketTimeout: IMAP_SOCKET_TIMEOUT_MS,
    });
  });

  it('never sends an auth option at all when no credential ciphertext is configured', async () => {
    const { client } = fakeClient();
    const encryption = fakeEncryption();
    const reader = new ImapMailboxReader(fakeConfig({ imapCredentialsCiphertext: null }) as never, encryption as never);
    let capturedOptions: Record<string, unknown> | undefined;
    reader.clientFactory = (options) => {
      capturedOptions = options as never;
      return client as never;
    };

    await reader.getMailboxState('INBOX');

    expect(encryption.decrypt).not.toHaveBeenCalled();
    expect(capturedOptions?.auth).toBeUndefined();
  });

  it('opens the mailbox using the exact folder name passed in, verbatim', async () => {
    const { client, getMailboxLock } = fakeClient();
    const reader = new ImapMailboxReader(fakeConfig() as never, fakeEncryption() as never);
    reader.clientFactory = () => client as never;

    await reader.getMailboxState('Sales.2026');

    expect(getMailboxLock).toHaveBeenCalledWith('Sales.2026');
  });

  it('reads UIDVALIDITY (bigint) and UIDNEXT (converted to bigint) correctly from the opened mailbox', async () => {
    const { client } = fakeClient({ uidValidity: 123456789n, uidNext: 999 });
    const reader = new ImapMailboxReader(fakeConfig() as never, fakeEncryption() as never);
    reader.clientFactory = () => client as never;

    const state = await reader.getMailboxState('INBOX');

    expect(state.uidValidity).toBe(123456789n);
    expect(state.uidNext).toBe(999n);
    expect(typeof state.uidNext).toBe('bigint');
  });

  // --- Protocol correctness pass: finite UID range + fetch-time UIDVALIDITY check (§1, §2) ---

  it('fetches using a FINITE UID-based incremental range (never "*"), never sequence numbers', async () => {
    const { client, fetch } = fakeClient({ fetchMessages: [], uidValidity: 7n, uidNext: 200 });
    const reader = new ImapMailboxReader(fakeConfig() as never, fakeEncryption() as never);
    reader.clientFactory = () => client as never;

    await reader.fetchMessagesSince('INBOX', 7n, 100n, 10);

    // uidNext=200 -> currentUpperUid=199 -> range is the finite "101:199", never "101:*".
    expect(fetch).toHaveBeenCalledWith(
      '101:199',
      expect.objectContaining({ uid: true, source: { maxLength: MAX_INBOUND_MESSAGE_BYTES } }),
      { uid: true },
    );
  });

  it('A — no UID greater than afterUid exists: returns [] without ever calling fetch (never re-returns the highest historical message)', async () => {
    const { client, fetch } = fakeClient({ uidValidity: 7n, uidNext: 101 }); // highest existing UID = 100.
    const reader = new ImapMailboxReader(fakeConfig() as never, fakeEncryption() as never);
    reader.clientFactory = () => client as never;

    const result = await reader.fetchMessagesSince('INBOX', 7n, 100n, 10);

    expect(result).toEqual({ outcome: 'ok', messages: [] });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('B — fetches exactly the finite range for newly-arrived UIDs 101,102,103 (uidNext=104)', async () => {
    const fetchMessages: FakeFetchMessage[] = [101, 102, 103].map((uid) => ({ uid, source: undefined }));
    const { client, fetch } = fakeClient({ fetchMessages, uidValidity: 7n, uidNext: 104 });
    const reader = new ImapMailboxReader(fakeConfig() as never, fakeEncryption() as never);
    reader.clientFactory = () => client as never;

    const result = await reader.fetchMessagesSince('INBOX', 7n, 100n, 10);

    expect(fetch).toHaveBeenCalledWith('101:103', expect.anything(), { uid: true });
    expect(expectOk(result).map((m) => m.uid)).toEqual([101n, 102n, 103n]);
  });

  it('C — a cursor ahead of the current highest UID (post-expunge) never triggers a fetch or returns an older message', async () => {
    const { client, fetch } = fakeClient({ uidValidity: 7n, uidNext: 201 }); // highest ever assigned = 200.
    const reader = new ImapMailboxReader(fakeConfig() as never, fakeEncryption() as never);
    reader.clientFactory = () => client as never;

    const result = await reader.fetchMessagesSince('INBOX', 7n, 200n, 10);

    expect(result).toEqual({ outcome: 'ok', messages: [] });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('D — the batch limit is still respected under the new finite-range fetch', async () => {
    const fetchMessages: FakeFetchMessage[] = [1, 2, 3, 4, 5].map((uid) => ({ uid, source: undefined }));
    const { client } = fakeClient({ fetchMessages, uidValidity: 7n, uidNext: 200 });
    const reader = new ImapMailboxReader(fakeConfig() as never, fakeEncryption() as never);
    reader.clientFactory = () => client as never;

    const result = await reader.fetchMessagesSince('INBOX', 7n, 0n, 3);

    expect(expectOk(result)).toHaveLength(3);
  });

  it('checks the expected UIDVALIDITY inside the same selected-mailbox operation as the fetch, and fetches nothing on mismatch', async () => {
    const { client, fetch } = fakeClient({ uidValidity: 9n /* current, differs from expected */, uidNext: 200 });
    const reader = new ImapMailboxReader(fakeConfig() as never, fakeEncryption() as never);
    reader.clientFactory = () => client as never;

    const result = await reader.fetchMessagesSince('INBOX', 7n /* expected (stale) */, 0n, 10);

    expect(result).toEqual({ outcome: 'uidvalidity_changed', currentUidValidity: 9n });
    expect(fetch).not.toHaveBeenCalled(); // no message source is EVER fetched under a stale identity.
  });

  it('never fetches a message source after a UIDVALIDITY mismatch is detected, even if messages would otherwise exist', async () => {
    const fetchMessages: FakeFetchMessage[] = [{ uid: 1, source: Buffer.from('should never be read') }];
    const { client, fetch } = fakeClient({ fetchMessages, uidValidity: 9n, uidNext: 200 });
    const reader = new ImapMailboxReader(fakeConfig() as never, fakeEncryption() as never);
    reader.clientFactory = () => client as never;

    await reader.fetchMessagesSince('INBOX', 7n, 0n, 10);

    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns messages sorted ascending by UID regardless of fetch order', async () => {
    const fetchMessages: FakeFetchMessage[] = [5, 1, 3].map((uid) => ({ uid, source: undefined }));
    const { client } = fakeClient({ fetchMessages, uidValidity: 7n, uidNext: 200 });
    const reader = new ImapMailboxReader(fakeConfig() as never, fakeEncryption() as never);
    reader.clientFactory = () => client as never;

    const result = await reader.fetchMessagesSince('INBOX', 7n, 0n, 10);

    expect(expectOk(result).map((r) => r.uid)).toEqual([1n, 3n, 5n]);
  });

  it('preserves UID values safely as BigInt', async () => {
    const { client } = fakeClient({
      fetchMessages: [{ uid: 4294967290, source: undefined }],
      uidValidity: 7n,
      uidNext: 4294967295,
    });
    const reader = new ImapMailboxReader(fakeConfig() as never, fakeEncryption() as never);
    reader.clientFactory = () => client as never;

    const result = await reader.fetchMessagesSince('INBOX', 7n, 0n, 10);

    expect(expectOk(result)[0]!.uid).toBe(4294967290n);
  });

  it('carries INTERNALDATE through as the internalDate field (never the Date header)', async () => {
    const when = new Date('2026-01-01T12:00:00.000Z');
    const { client } = fakeClient({ fetchMessages: [{ uid: 1, internalDate: when, source: undefined }], uidValidity: 7n, uidNext: 200 });
    const reader = new ImapMailboxReader(fakeConfig() as never, fakeEncryption() as never);
    reader.clientFactory = () => client as never;

    const result = await reader.fetchMessagesSince('INBOX', 7n, 0n, 10);

    expect(expectOk(result)[0]!.internalDate).toEqual(when);
  });

  it('parses a message via messageParser and discards any attachments the parser returns', async () => {
    const rawSource = Buffer.from('From: a@b.com\r\nSubject: hi\r\n\r\nbody');
    const { client } = fakeClient({ fetchMessages: [{ uid: 1, source: rawSource }], uidValidity: 7n, uidNext: 200 });
    const reader = new ImapMailboxReader(fakeConfig() as never, fakeEncryption() as never);
    reader.clientFactory = () => client as never;
    reader.messageParser = (() =>
      Promise.resolve({
        subject: 'hi',
        from: { value: [{ address: 'a@b.com' }] },
        to: undefined,
        headers: new Map(),
        text: 'body',
        html: false,
        attachments: [{ filename: 'evil.exe', content: Buffer.from('malware') }],
      })) as never;

    const result = await reader.fetchMessagesSince('INBOX', 7n, 0n, 10);
    const messages = expectOk(result);

    expect(messages[0]!.subject).toBe('hi');
    expect(Object.keys(messages[0]!)).not.toContain('attachments');
    const bigintSafeReplacer = (_key: string, value: unknown): unknown =>
      typeof value === 'bigint' ? value.toString() : value;
    const serialized = JSON.stringify(messages[0], bigintSafeReplacer);
    expect(serialized).not.toContain('evil.exe');
  });

  it('falls back to a minimal parseFailed record when messageParser throws', async () => {
    const { client } = fakeClient({ fetchMessages: [{ uid: 1, source: Buffer.from('garbage') }], uidValidity: 7n, uidNext: 200 });
    const reader = new ImapMailboxReader(fakeConfig() as never, fakeEncryption() as never);
    reader.clientFactory = () => client as never;
    reader.messageParser = (() => Promise.reject(new Error('malformed MIME'))) as never;

    const result = await reader.fetchMessagesSince('INBOX', 7n, 0n, 10);
    const messages = expectOk(result);

    expect(messages[0]!.parseFailed).toBe(true);
    expect(messages[0]!.subject).toBeUndefined();
  });

  it('close() logs out cleanly and is safe to call even if never connected', async () => {
    const { client, logout } = fakeClient();
    const reader = new ImapMailboxReader(fakeConfig() as never, fakeEncryption() as never);
    reader.clientFactory = () => client as never;

    await reader.close(); // never connected — must not throw.

    await reader.getMailboxState('INBOX');
    await reader.close();
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it('close() falls back to a hard close when logout() throws', async () => {
    const { client, close } = fakeClient();
    client.logout = jest.fn(() => Promise.reject(new Error('connection already gone')));
    const reader = new ImapMailboxReader(fakeConfig() as never, fakeEncryption() as never);
    reader.clientFactory = () => client as never;

    await reader.getMailboxState('INBOX');
    await reader.close();

    expect(close).toHaveBeenCalledTimes(1);
  });

  it('never includes the decrypted password in a connection failure error message', async () => {
    const { client } = fakeClient();
    client.connect = jest.fn(() => Promise.reject(new Error('Authentication credentials invalid')));
    const reader = new ImapMailboxReader(fakeConfig() as never, fakeEncryption() as never);
    reader.clientFactory = () => client as never;

    expect.assertions(1);
    try {
      await reader.getMailboxState('INBOX');
    } catch (error) {
      expect(String((error as Error).message)).not.toContain(REAL_PASSWORD);
    }
  });

  it('reuses the same connection/lock across getMailboxState then fetchMessagesSince for the same folder', async () => {
    const { client, connect, getMailboxLock } = fakeClient({ fetchMessages: [], uidValidity: 7n, uidNext: 200 });
    const reader = new ImapMailboxReader(fakeConfig() as never, fakeEncryption() as never);
    reader.clientFactory = () => client as never;

    await reader.getMailboxState('INBOX');
    await reader.fetchMessagesSince('INBOX', 7n, 0n, 10);

    expect(connect).toHaveBeenCalledTimes(1);
    expect(getMailboxLock).toHaveBeenCalledTimes(1);
  });

  describe('MICROSOFT_OAUTH2 credentials', () => {
    // Deliberately NOT cast to MicrosoftOAuthTokenProvider here — keeping it a plain object literal
    // lets `expect(tokenProvider.getAccessToken).toHaveBeenCalledWith(...)` reference the mock
    // directly (casting to the class type makes ESLint's unbound-method rule flag it). The cast
    // happens only at the ImapMailboxReader constructor call site, via `as never`, exactly like
    // `encryption as never` already does for SecretEncryptionService above.
    function fakeTokenProvider(accessToken = 'access-token-abc') {
      return { getAccessToken: jest.fn(() => Promise.resolve(accessToken)) };
    }

    function fakeOAuthEncryption() {
      return {
        decrypt: jest.fn(() => ({
          authMode: 'MICROSOFT_OAUTH2',
          tenantId: 'tenant-1',
          clientId: 'client-1',
          clientSecret: 'super-secret-client-secret',
        })),
      };
    }

    it('resolves an access token via the token provider and connects with it, never a password', async () => {
      const { client } = fakeClient();
      const encryption = fakeOAuthEncryption();
      const tokenProvider = fakeTokenProvider('access-token-abc');
      const reader = new ImapMailboxReader(
        fakeConfig({ imapHost: 'outlook.office365.com', imapPort: 993, imapUsername: 'renewals@example.onmicrosoft.com' }) as never,
        encryption as never,
        tokenProvider as never,
      );
      let capturedOptions: Record<string, unknown> | undefined;
      reader.clientFactory = (options) => {
        capturedOptions = options as never;
        return client as never;
      };

      await reader.getMailboxState('INBOX');

      expect(tokenProvider.getAccessToken).toHaveBeenCalledWith(
        expect.objectContaining({ authMode: 'MICROSOFT_OAUTH2', tenantId: 'tenant-1', clientId: 'client-1' }),
      );
      expect(capturedOptions?.auth).toEqual({ user: 'renewals@example.onmicrosoft.com', accessToken: 'access-token-abc' });
      expect(JSON.stringify(capturedOptions)).not.toContain('super-secret-client-secret');
    });

    it('does not call the token provider at all for a BASIC-credentialed configuration', async () => {
      const { client } = fakeClient();
      const encryption = fakeEncryption();
      const tokenProvider = fakeTokenProvider();
      const reader = new ImapMailboxReader(fakeConfig() as never, encryption as never, tokenProvider as never);
      reader.clientFactory = () => client as never;

      await reader.getMailboxState('INBOX');

      expect(tokenProvider.getAccessToken).not.toHaveBeenCalled();
    });

    it('propagates a token-provider failure without ever connecting', async () => {
      const { client, connect } = fakeClient();
      const encryption = fakeOAuthEncryption();
      const tokenProvider = {
        getAccessToken: jest.fn(() => Promise.reject(new Error('Microsoft OAuth token request rejected (status 401).'))),
      };
      const reader = new ImapMailboxReader(fakeConfig() as never, encryption as never, tokenProvider as never);
      reader.clientFactory = () => client as never;

      await expect(reader.getMailboxState('INBOX')).rejects.toThrow('status 401');
      expect(connect).not.toHaveBeenCalled();
    });
  });
});
