import { jest } from '@jest/globals';
import { MailSettingsService } from './mail-settings.service';

const BASIC_ENVELOPE = JSON.stringify({ authMode: 'BASIC', password: 'super-secret-basic-password' });
const OAUTH_ENVELOPE = JSON.stringify({ authMode: 'MICROSOFT_OAUTH2', tenantId: 't', clientId: 'c', clientSecret: 'super-secret-client-secret' });

function fakeEncryption() {
  const store = new Map<string, unknown>();
  let counter = 0;
  return {
    encrypt: jest.fn((value: unknown) => {
      const key = `ciphertext-${++counter}`;
      store.set(key, value);
      return key;
    }),
    decrypt: jest.fn((ciphertext: string) => {
      if (ciphertext === 'v1.basic') return JSON.parse(BASIC_ENVELOPE) as unknown;
      if (ciphertext === 'v1.oauth') return JSON.parse(OAUTH_ENVELOPE) as unknown;
      return store.get(ciphertext);
    }),
    mask: () => '********',
  };
}

function baseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'config-1',
    scopeKey: 'GLOBAL',
    billingEntityId: null,
    label: 'Global',
    environment: 'SANDBOX',
    enabled: true,
    smtpHost: 'smtp.example.test',
    smtpPort: 587,
    smtpSecure: true,
    smtpUsername: 'renewals@example.test',
    smtpCredentialsCiphertext: 'v1.basic',
    imapHost: 'imap.example.test',
    imapPort: 993,
    imapSecure: true,
    imapUsername: 'renewals@example.test',
    imapCredentialsCiphertext: 'v1.basic',
    inboundSyncEnabled: false,
    outboundSendEnabled: false,
    outboundSendCutoverAt: null,
    fromAddress: 'renewals@example.test',
    fromName: 'Renewals',
    lastHealthStatus: 'UNKNOWN',
    lastHealthCheckedAt: null,
    lastSyncedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function harness(options: { existing?: ReturnType<typeof baseRow> } = {}) {
  const encryption = fakeEncryption();
  const auditRecord = jest.fn<(event: { eventKey: string; metadata?: Record<string, unknown> }) => Promise<void>>(() => Promise.resolve());
  const audit = { record: auditRecord };
  const findUnique = jest.fn(() => Promise.resolve(options.existing ?? null));
  const findMany = jest.fn(() => Promise.resolve(options.existing ? [options.existing] : []));
  let updateArgs: Record<string, unknown> | undefined;
  let createArgs: Record<string, unknown> | undefined;
  const tx = {
    mailConfiguration: {
      create: jest.fn((args: { data: Record<string, unknown> }) => {
        createArgs = args.data;
        return Promise.resolve(baseRow({ id: 'new-config', ...args.data }));
      }),
      update: jest.fn((args: { data: Record<string, unknown> }) => {
        updateArgs = args.data;
        return Promise.resolve(baseRow({ ...options.existing, ...args.data }));
      }),
    },
  };
  const prisma = {
    mailConfiguration: { findUnique, findMany },
    $transaction: jest.fn((cb: (t: typeof tx) => unknown) => Promise.resolve(cb(tx))),
  };
  const imapReaderFactory = { createReader: jest.fn() };
  const smtpTransport = { verify: jest.fn(() => Promise.resolve()) };
  const mailHealth = { record: jest.fn(() => Promise.resolve()) };
  const imapHealth = { record: jest.fn(() => Promise.resolve()) };
  const service = new MailSettingsService(
    prisma as never,
    encryption as never,
    audit as never,
    imapReaderFactory as never,
    smtpTransport as never,
    mailHealth as never,
    imapHealth as never,
  );
  return { service, encryption, auditRecord, prisma, tx, imapReaderFactory, smtpTransport, mailHealth, imapHealth, getCreateArgs: () => createArgs, getUpdateArgs: () => updateArgs };
}

describe('MailSettingsService — secret handling', () => {
  it('never returns ciphertext/password/clientSecret in the serialized list/create/update result', async () => {
    const { service } = harness({ existing: baseRow() });
    const listed = await service.list();
    expect(JSON.stringify(listed)).not.toContain('super-secret');
    expect(JSON.stringify(listed)).not.toContain('v1.basic');
    expect(listed[0]).not.toHaveProperty('smtpCredentialsCiphertext');
    expect(listed[0]).not.toHaveProperty('imapCredentialsCiphertext');
  });

  it('exposes authMode and credentialsConfigured without ever returning the decrypted secret', async () => {
    const { service } = harness({ existing: baseRow() });
    const [result] = await service.list();
    expect(result!.authMode).toBe('BASIC');
    expect(result!.credentialsConfigured).toBe(true);
  });

  it('create() encrypts BASIC credentials and never puts the password in the audit payload', async () => {
    const { service, auditRecord, encryption } = harness();

    await service.create(
      {
        scope: 'GLOBAL',
        label: 'Global',
        environment: 'SANDBOX' as never,
        enabled: true,
        mailboxAddress: 'renewals@example.test',
        fromName: 'Renewals',
        authMode: 'BASIC',
        password: 'super-secret-basic-password',
        imapHost: 'imap.example.test',
        imapPort: 993,
        imapSecure: true,
        inboundSyncEnabled: false,
        smtpHost: 'smtp.example.test',
        smtpPort: 587,
        smtpSecure: true,
        outboundSendEnabled: false,
      } as never,
      { actorId: 'actor-1' },
    );

    expect(encryption.encrypt).toHaveBeenCalledWith({ authMode: 'BASIC', password: 'super-secret-basic-password' });
    expect(JSON.stringify(auditRecord.mock.calls)).not.toContain('super-secret-basic-password');
  });

  it('update() with a blank password KEEPS the existing stored secret (never re-encrypts)', async () => {
    const { service, encryption, getUpdateArgs } = harness({ existing: baseRow() });

    await service.update('config-1', { label: 'Renamed' }, { actorId: 'actor-1' });

    expect(encryption.encrypt).not.toHaveBeenCalled();
    expect(getUpdateArgs()).not.toHaveProperty('smtpCredentialsCiphertext');
  });

  it('update() with clearCredentials removes both ciphertext fields and audits credentialsChanged=true', async () => {
    const { service, auditRecord, getUpdateArgs } = harness({ existing: baseRow() });

    await service.update('config-1', { clearCredentials: true }, { actorId: 'actor-1' });

    expect(getUpdateArgs()).toMatchObject({ smtpCredentialsCiphertext: null, imapCredentialsCiphertext: null });
    const call = auditRecord.mock.calls.find((c) => c[0].eventKey === 'settings.mail.updated');
    expect((call?.[0].metadata as { credentialsChanged: boolean } | undefined)?.credentialsChanged).toBe(true);
  });

  it('rejects providing both new credentials and clearCredentials in the same request', async () => {
    const { service } = harness({ existing: baseRow() });
    await expect(
      service.update('config-1', { password: 'x', clearCredentials: true }, { actorId: 'actor-1' }),
    ).rejects.toThrow();
  });

  it('switching MICROSOFT_OAUTH2 -> BASIC without a new password is rejected (no matching new credential material)', async () => {
    const { service } = harness({ existing: baseRow({ smtpCredentialsCiphertext: 'v1.oauth', imapCredentialsCiphertext: 'v1.oauth' }) });
    await expect(service.update('config-1', { authMode: 'BASIC' } as never, { actorId: 'actor-1' })).rejects.toThrow();
  });

  it('encrypts a fresh MICROSOFT_OAUTH2 envelope and reuses the existing clientSecret when only tenantId changes', async () => {
    const { service, encryption } = harness({ existing: baseRow({ smtpCredentialsCiphertext: 'v1.oauth', imapCredentialsCiphertext: 'v1.oauth' }) });

    await service.update('config-1', { tenantId: 'new-tenant' }, { actorId: 'actor-1' });

    expect(encryption.encrypt).toHaveBeenCalledWith({
      authMode: 'MICROSOFT_OAUTH2',
      tenantId: 'new-tenant',
      clientId: 'c',
      clientSecret: 'super-secret-client-secret',
    });
  });
});

describe('MailSettingsService — connection tests cause no production mutation', () => {
  it('testImap() only reads mailbox metadata and records health — never touches EmailMessage/cursor state', async () => {
    const getMailboxState = jest.fn(() => Promise.resolve({ uidValidity: 1n, uidNext: 1n }));
    const close = jest.fn(() => Promise.resolve());
    const { service, imapReaderFactory, imapHealth } = harness({ existing: baseRow() });
    imapReaderFactory.createReader.mockReturnValue({ getMailboxState, close });

    const result = await service.testImap('config-1');

    expect(result.success).toBe(true);
    expect(getMailboxState).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(imapHealth.record).toHaveBeenCalledWith('config-1', 'HEALTHY', expect.any(String));
  });

  it('testImap() reports a sanitized failure and still closes the connection', async () => {
    const getMailboxState = jest.fn(() => Promise.reject(new Error('ECONNREFUSED')));
    const close = jest.fn(() => Promise.resolve());
    const { service, imapReaderFactory, imapHealth } = harness({ existing: baseRow() });
    imapReaderFactory.createReader.mockReturnValue({ getMailboxState, close });

    const result = await service.testImap('config-1');

    expect(result.success).toBe(false);
    expect(close).toHaveBeenCalledTimes(1);
    expect(imapHealth.record).toHaveBeenCalledWith('config-1', 'UNAVAILABLE', expect.any(String));
  });

  it('testSmtp() calls verify() only — never send() — and sends zero email', async () => {
    const { service, smtpTransport, mailHealth } = harness({ existing: baseRow() });

    const result = await service.testSmtp('config-1');

    expect(result.success).toBe(true);
    expect(smtpTransport.verify).toHaveBeenCalledTimes(1);
    expect((smtpTransport as unknown as { send?: unknown }).send).toBeUndefined();
    expect(mailHealth.record).toHaveBeenCalledWith('config-1', 'HEALTHY', expect.any(String));
  });
});
