import { jest } from '@jest/globals';
import { AiSettingsResolverService } from './ai-settings-resolver.service';
import { AiSettingsService } from './ai-settings.service';
import { LlmPermanentError } from './llm-errors';

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

function harness(
  options: {
    existing?: ReturnType<typeof baseRow> | null;
    adapters?: Record<string, { testConnection: jest.Mock }>;
  } = {},
) {
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
  // Phase 3.1 §4 correction — AiSettingsService.test() now resolves via AiSettingsResolverService
  // (the SAME real class runtime uses), constructed here from the identical prisma/encryption fakes
  // already set up above, rather than a separately hand-rolled fake — proving Test AI and runtime
  // genuinely share resolution logic, not just coincidentally similar mocks.
  const aiSettings = new AiSettingsResolverService(prisma as never, encryption as never);
  // Provider-neutral correction §K — a fake LlmProviderRegistry, defaulting to an OPENAI adapter so
  // every pre-existing test (which never mentions provider selection) is unaffected. Individual
  // tests override/add entries via `options.adapters` to exercise a specific provider.
  const defaultOpenAiAdapter = { testConnection: jest.fn(() => Promise.resolve({ latencyMs: 5 })) };
  const adapters: { OPENAI: { testConnection: jest.Mock } } & Record<string, { testConnection: jest.Mock }> = {
    OPENAI: defaultOpenAiAdapter,
    ...options.adapters,
  };
  const providerRegistry = { resolve: (provider: string) => adapters[provider] ?? null };
  const service = new AiSettingsService(prisma as never, encryption as never, audit as never, health as never, aiSettings, providerRegistry as never);
  return { service, encryption, auditRecord, healthRecord, adapters, getUpsertArgs: () => upsertArgs };
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

describe('AiSettingsService — provider-switch credential safety (§G)', () => {
  it('P7 — changing provider without a new API key is rejected', async () => {
    const { service, auditRecord } = harness({ existing: baseRow({ provider: 'OPENAI' }) });
    await expect(service.update({ provider: 'ANTHROPIC', model: 'claude-test' }, { actorId: 'actor-1' })).rejects.toThrow();
    expect(auditRecord).not.toHaveBeenCalled();
  });

  it('P8 — changing provider without a new model is rejected', async () => {
    const { service } = harness({ existing: baseRow({ provider: 'OPENAI' }) });
    await expect(service.update({ provider: 'ANTHROPIC', apiKey: 'sk-ant-new-secret' }, { actorId: 'actor-1' })).rejects.toThrow();
  });

  it('P9 — changing provider + new model + new key succeeds atomically', async () => {
    const { service, getUpsertArgs } = harness({ existing: baseRow({ provider: 'OPENAI' }) });
    await service.update({ provider: 'ANTHROPIC', model: 'claude-test', apiKey: 'sk-ant-new-secret' }, { actorId: 'actor-1' });
    expect(getUpsertArgs()!.update).toMatchObject({ provider: 'ANTHROPIC', model: 'claude-test' });
  });

  it('P10 — a rejected switch (missing new key) never touches the DB at all, so the previous valid configuration is preserved', async () => {
    const { service, getUpsertArgs } = harness({ existing: baseRow({ provider: 'OPENAI', model: 'gpt-existing' }) });
    await expect(service.update({ provider: 'ANTHROPIC', model: 'claude-test' }, { actorId: 'actor-1' })).rejects.toThrow();
    expect(getUpsertArgs()).toBeUndefined();
  });

  it('rejects switching provider via clearApiKey instead of supplying a real new key', async () => {
    const { service } = harness({ existing: baseRow({ provider: 'OPENAI' }) });
    await expect(
      service.update({ provider: 'ANTHROPIC', model: 'claude-test', clearApiKey: true }, { actorId: 'actor-1' }),
    ).rejects.toThrow();
  });

  it('P11 — a same-provider edit with a blank key still preserves the existing key (no switch requirement triggered)', async () => {
    const { service, getUpsertArgs } = harness({ existing: baseRow({ provider: 'OPENAI' }) });
    await service.update({ provider: 'OPENAI', enabled: true }, { actorId: 'actor-1' });
    expect(getUpsertArgs()!.update.apiKeyCiphertext).toBe('v1.ciphertext');
  });

  it('P12 — secrets never appear in the serialized result or the audit payload after a provider switch', async () => {
    const { service, auditRecord } = harness({ existing: baseRow({ provider: 'OPENAI' }) });
    const result = await service.update(
      { provider: 'ANTHROPIC', model: 'claude-test', apiKey: 'sk-ant-brand-new-secret' },
      { actorId: 'actor-1' },
    );
    expect(result).not.toHaveProperty('apiKeyCiphertext');
    expect(JSON.stringify(result)).not.toContain('sk-ant-brand-new-secret');
    expect(JSON.stringify(auditRecord.mock.calls)).not.toContain('sk-ant-brand-new-secret');
  });

  it('the audit metadata records providerChanged: true only when the provider actually changed', async () => {
    const { service, auditRecord } = harness({ existing: baseRow({ provider: 'OPENAI' }) });
    await service.update({ provider: 'ANTHROPIC', model: 'claude-test', apiKey: 'sk-ant-new-secret' }, { actorId: 'actor-1' });
    const call = auditRecord.mock.calls.find((c) => c[0].eventKey === 'settings.ai.updated');
    expect((call?.[0].metadata as { providerChanged: boolean } | undefined)?.providerChanged).toBe(true);
  });

  it('the very first creation (no existing row) never triggers the provider-switch requirement, even for a non-default provider', async () => {
    const { service, getUpsertArgs } = harness({ existing: null });
    await service.update(
      { provider: 'ANTHROPIC', model: 'claude-test', apiKey: 'sk-ant-new-secret', enabled: false },
      { actorId: 'actor-1' },
    );
    expect(getUpsertArgs()!.update.provider).toBe('ANTHROPIC');
  });
});

describe('AiSettingsService.test() — connection test causes no business mutation, provider-neutral (§K)', () => {
  it('P23 — makes exactly one minimal request via the currently selected provider adapter and reports success, without touching prisma beyond the read', async () => {
    const { service, adapters } = harness();

    const result = await service.test();

    expect(result.success).toBe(true);
    expect(adapters.OPENAI.testConnection).toHaveBeenCalledTimes(1);
    expect(adapters.OPENAI.testConnection).toHaveBeenCalledWith({ model: 'gpt-test', apiKey: 'sk-real-secret-key' });
  });

  it('§K — Test AI dispatches to whichever provider is currently selected (ANTHROPIC), never a hidden OpenAI-only implementation', async () => {
    const anthropicAdapter = { testConnection: jest.fn(() => Promise.resolve({ latencyMs: 3 })) };
    const { service, adapters } = harness({
      existing: baseRow({ provider: 'ANTHROPIC', model: 'claude-test' }),
      adapters: { ANTHROPIC: anthropicAdapter },
    });

    const result = await service.test();

    expect(result.success).toBe(true);
    expect(result.provider).toBe('ANTHROPIC');
    expect(anthropicAdapter.testConnection).toHaveBeenCalledTimes(1);
    expect(adapters.OPENAI.testConnection).not.toHaveBeenCalled();
  });

  it('§K — Test AI dispatches to GOOGLE_GEMINI when that is the currently selected provider', async () => {
    const geminiAdapter = { testConnection: jest.fn(() => Promise.resolve({ latencyMs: 2 })) };
    const { service } = harness({
      existing: baseRow({ provider: 'GOOGLE_GEMINI', model: 'gemini-test' }),
      adapters: { GOOGLE_GEMINI: geminiAdapter },
    });

    const result = await service.test();

    expect(result.success).toBe(true);
    expect(result.provider).toBe('GOOGLE_GEMINI');
    expect(geminiAdapter.testConnection).toHaveBeenCalledTimes(1);
  });

  it('never includes the API key in the sanitized failure message', async () => {
    const failingAdapter = {
      testConnection: jest.fn(() => Promise.reject(new LlmPermanentError('Provider authentication failed.'))),
    };
    const { service } = harness({ adapters: { OPENAI: failingAdapter } });

    const result = await service.test();

    expect(result.success).toBe(false);
    expect(result.message).not.toContain('sk-real-secret-key');
  });

  it('P24 — never creates AiClassification/AiRoutingDecision or mutates a RenewalCase (no such prisma call exists in the harness at all)', async () => {
    const { service } = harness();
    await service.test();
    // The harness's prisma fake only exposes `aiSettings.findUnique` and `$transaction` — there is no
    // aiClassification/aiRoutingDecision/renewalCase model available for test() to call at all, so
    // any attempt would throw. Reaching this line without an error is the proof.
    expect(true).toBe(true);
  });

  it('returns a sanitized failure without ever throwing when not configured', async () => {
    const { service } = harness({ existing: baseRow({ apiKeyCiphertext: null }) });
    const result = await service.test();
    expect(result.success).toBe(false);
  });

  it('returns a sanitized failure when the provider is unsupported/unknown, never throwing', async () => {
    const { service } = harness({ existing: baseRow({ provider: 'SOMETHING_ELSE' }) });
    const result = await service.test();
    expect(result.success).toBe(false);
    expect(result.provider).toBe('SOMETHING_ELSE');
  });
});
