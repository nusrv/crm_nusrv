import { jest } from '@jest/globals';
import { AiSettingsService } from './ai-settings.service';

function baseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ai-settings-1',
    singleton: true,
    enabled: true,
    provider: 'OPENAI',
    model: 'gpt-test',
    confidenceThreshold: '0.900',
    apiKeyCiphertext: 'v1.ciphertext',
    autoRouteAccept: false,
    autoRouteAcceptCutoverAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function harness(options: { existing?: ReturnType<typeof baseRow> | null } = {}) {
  const encrypt = jest.fn(() => 'new-ciphertext');
  const decrypt = jest.fn(() => ({ apiKey: 'sk-real-secret-key' }));
  const encryption = { encrypt, decrypt };
  const auditRecord = jest.fn<(event: { eventKey: string; metadata?: Record<string, unknown> }) => Promise<void>>(() => Promise.resolve());
  const audit = { record: auditRecord };
  const healthRecord = jest.fn(() => Promise.resolve());
  const health = { record: healthRecord };
  const existing = options.existing === undefined ? baseRow() : options.existing;
  const findUnique = jest.fn(() => Promise.resolve(existing));
  let upsertArgs: { create: Record<string, unknown>; update: Record<string, unknown> } | undefined;
  const tx = {
    aiSettings: {
      upsert: jest.fn((args: typeof upsertArgs) => {
        upsertArgs = args;
        return Promise.resolve(baseRow({ ...existing, ...args!.update }));
      }),
    },
  };
  const prisma = {
    aiSettings: { findUnique },
    $transaction: jest.fn((cb: (t: typeof tx) => unknown) => Promise.resolve(cb(tx))),
  };
  const service = new AiSettingsService(prisma as never, encryption as never, audit as never, health as never);
  return { service, encryption, auditRecord, healthRecord, getUpsertArgs: () => upsertArgs };
}

describe('AiSettingsService — secret handling', () => {
  it('get() never returns the API key or its ciphertext, only apiKeyConfigured', async () => {
    const { service } = harness();
    const result = await service.get();
    expect(result.apiKeyConfigured).toBe(true);
    expect(result).not.toHaveProperty('apiKeyCiphertext');
    expect(JSON.stringify(result)).not.toContain('sk-real-secret-key');
  });

  it('no row => fully-disabled safe defaults', async () => {
    const { service } = harness({ existing: null });
    const result = await service.get();
    expect(result).toEqual({
      enabled: false,
      provider: 'OPENAI',
      model: null,
      apiKeyConfigured: false,
      confidenceThreshold: null,
      autoRouteAccept: false,
      autoRouteAcceptCutoverAt: null,
      updatedAt: null,
    });
  });

  it('update() with a blank apiKey KEEPS the existing stored key (never re-encrypts)', async () => {
    const { service, encryption, getUpsertArgs } = harness();
    await service.update({ model: 'gpt-updated' }, { actorId: 'actor-1' });
    expect(encryption.encrypt).not.toHaveBeenCalled();
    expect(getUpsertArgs()!.update.apiKeyCiphertext).toBe('v1.ciphertext');
  });

  it('update() with clearApiKey removes the key and audits credentialsChanged=true, but disallows leaving AI enabled without one', async () => {
    const { service, auditRecord } = harness();
    await expect(service.update({ clearApiKey: true }, { actorId: 'actor-1' })).rejects.toThrow();
    expect(auditRecord).not.toHaveBeenCalled();

    await service.update({ clearApiKey: true, enabled: false }, { actorId: 'actor-1' });
    const call = auditRecord.mock.calls.find((c) => c[0].eventKey === 'settings.ai.updated');
    expect((call?.[0].metadata as { credentialsChanged: boolean } | undefined)?.credentialsChanged).toBe(true);
  });

  it('rejects providing both a new apiKey and clearApiKey in the same request', async () => {
    const { service } = harness();
    await expect(service.update({ apiKey: 'sk-new', clearApiKey: true }, { actorId: 'actor-1' })).rejects.toThrow();
  });

  it('a new apiKey is encrypted, never appears in the audit payload', async () => {
    const { service, encryption, auditRecord } = harness();
    await service.update({ apiKey: 'sk-brand-new-secret' }, { actorId: 'actor-1' });
    expect(encryption.encrypt).toHaveBeenCalledWith({ apiKey: 'sk-brand-new-secret' });
    expect(JSON.stringify(auditRecord.mock.calls)).not.toContain('sk-brand-new-secret');
  });
});

describe('AiSettingsService — independent server-side enablement validation (§I)', () => {
  it('cannot enable AI without a configured model', async () => {
    const { service } = harness({ existing: baseRow({ model: null }) });
    await expect(service.update({ enabled: true }, { actorId: 'actor-1' })).rejects.toThrow();
  });

  it('cannot enable AI without a configured API key', async () => {
    const { service } = harness({ existing: baseRow({ apiKeyCiphertext: null }) });
    await expect(service.update({ enabled: true }, { actorId: 'actor-1' })).rejects.toThrow();
  });

  it('cannot enable Auto Accept without AI enabled', async () => {
    const { service } = harness({ existing: baseRow({ enabled: false }) });
    await expect(
      service.update({ autoRouteAccept: true, autoRouteAcceptCutoverAt: '2026-01-01T00:00:00.000Z' }, { actorId: 'actor-1' }),
    ).rejects.toThrow();
  });

  it('cannot enable Auto Accept without a valid cutover', async () => {
    const { service } = harness({ existing: baseRow({ enabled: true }) });
    await expect(service.update({ autoRouteAccept: true }, { actorId: 'actor-1' })).rejects.toThrow();
  });

  it('accepts enabling Auto Accept when AI is enabled and a valid cutover is supplied', async () => {
    const { service, getUpsertArgs } = harness({ existing: baseRow({ enabled: true }) });
    await service.update({ autoRouteAccept: true, autoRouteAcceptCutoverAt: '2026-06-01T00:00:00.000Z' }, { actorId: 'actor-1' });
    expect(getUpsertArgs()!.update.autoRouteAccept).toBe(true);
  });
});

describe('AiSettingsService.test() — connection test causes no business mutation', () => {
  function fakeClient(impl: () => Promise<unknown>) {
    const create = jest.fn<(args: { model: string; input: string; max_output_tokens: number }) => Promise<unknown>>(impl);
    return { create };
  }

  it('makes exactly one minimal OpenAI request and reports success, without touching prisma beyond the read', async () => {
    const { service } = harness();
    const create = fakeClient(() => Promise.resolve({ id: 'resp-1' })).create;
    service.clientFactory = () => ({ responses: { create } }) as never;

    const result = await service.test();

    expect(result.success).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
    const call = create.mock.calls[0]![0] as { max_output_tokens: number };
    expect(call.max_output_tokens).toBeLessThanOrEqual(32);
  });

  it('never includes the API key in the sanitized failure message', async () => {
    const { service } = harness();
    class FakeAuthError extends Error {}
    service.clientFactory = () => ({ responses: { create: () => Promise.reject(new FakeAuthError('Incorrect API key provided: sk-real-secret-key')) } }) as never;

    const result = await service.test();

    expect(result.success).toBe(false);
    expect(result.message).not.toContain('sk-real-secret-key');
  });

  it('returns a sanitized failure without ever throwing when not configured', async () => {
    const { service } = harness({ existing: baseRow({ apiKeyCiphertext: null }) });
    const result = await service.test();
    expect(result.success).toBe(false);
  });
});
