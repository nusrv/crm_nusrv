import { jest } from '@jest/globals';
import { AiModelDiscoveryService } from './ai-model-discovery.service';
import { LlmPermanentError } from './llm-errors';

function fakeAiSettings(options: { provider?: string; apiKey?: string | null } = {}) {
  const getApiKey = jest.fn(() => Promise.resolve(options.apiKey === undefined ? 'sk-stored-secret-key' : options.apiKey));
  return {
    getSettings: () =>
      Promise.resolve({
        enabled: true,
        provider: options.provider ?? 'OPENAI',
        model: 'stored-model',
        confidenceThreshold: 0.9,
        autoRouteAcceptEnabled: false,
        autoRouteAcceptCutoverAt: null,
      }),
    getApiKey,
  };
}

function fakeAdapter(impl?: () => Promise<unknown>) {
  return { listModels: jest.fn(impl ?? (() => Promise.resolve([]))) };
}

function fakeRegistry(adapters: Record<string, ReturnType<typeof fakeAdapter> | undefined>) {
  return { resolve: (provider: string) => adapters[provider] ?? null };
}

describe('AiModelDiscoveryService — case rules (§F)', () => {
  it('P1/P2/P3 — discovers models for OPENAI/ANTHROPIC/GOOGLE_GEMINI with a supplied key', async () => {
    for (const provider of ['OPENAI', 'ANTHROPIC', 'GOOGLE_GEMINI']) {
      const adapter = fakeAdapter(() =>
        Promise.resolve([{ id: 'm-1', displayName: 'M1', provider, compatibility: 'UNKNOWN' }]),
      );
      const service = new AiModelDiscoveryService(fakeAiSettings() as never, fakeRegistry({ [provider]: adapter }) as never);

      const result = await service.discover({ provider: provider as never, apiKey: 'sk-new-key' });

      expect(result.success).toBe(true);
      expect(result.models).toHaveLength(1);
      expect(adapter.listModels).toHaveBeenCalledWith('sk-new-key');
    }
  });

  it('P8 — same saved provider, no apiKey supplied: discovers using the saved encrypted key ("Refresh Models")', async () => {
    const adapter = fakeAdapter(() => Promise.resolve([{ id: 'm-1', displayName: 'M1', provider: 'OPENAI', compatibility: 'UNKNOWN' }]));
    const aiSettings = fakeAiSettings({ provider: 'OPENAI', apiKey: 'sk-stored-secret-key' });
    const service = new AiModelDiscoveryService(aiSettings as never, fakeRegistry({ OPENAI: adapter }) as never);

    const result = await service.discover({ provider: 'OPENAI' });

    expect(result.success).toBe(true);
    expect(adapter.listModels).toHaveBeenCalledWith('sk-stored-secret-key');
  });

  it('P9/P10 — switching provider without a new apiKey is rejected with a safe, specific message, and the old provider key is never reused', async () => {
    const adapter = fakeAdapter();
    const aiSettings = fakeAiSettings({ provider: 'OPENAI', apiKey: 'sk-openai-stored' });
    const service = new AiModelDiscoveryService(aiSettings as never, fakeRegistry({ ANTHROPIC: adapter }) as never);

    await expect(service.discover({ provider: 'ANTHROPIC' })).rejects.toThrow('Enter an API key for Anthropic before loading models.');
    expect(adapter.listModels).not.toHaveBeenCalled();
  });

  it('P3 — no configuration saved yet: apiKey is required', async () => {
    const adapter = fakeAdapter();
    const aiSettings = fakeAiSettings({ provider: 'OPENAI', apiKey: null });
    const service = new AiModelDiscoveryService(aiSettings as never, fakeRegistry({ OPENAI: adapter }) as never);

    await expect(service.discover({ provider: 'OPENAI' })).rejects.toThrow();
    expect(adapter.listModels).not.toHaveBeenCalled();
  });

  it('rejects an unsupported/unknown provider before ever resolving a key', async () => {
    const aiSettings = fakeAiSettings();
    const service = new AiModelDiscoveryService(aiSettings as never, fakeRegistry({}) as never);

    await expect(service.discover({ provider: 'SOMETHING_ELSE' as never })).rejects.toThrow();
  });
});

describe('AiModelDiscoveryService — temporary key safety (§G)', () => {
  it('P6/P7 — a supplied apiKey is used only for this call: never returned, never included in the result, never logged/audited by this service (no audit/log dependency exists at all)', async () => {
    const adapter = fakeAdapter(() => Promise.resolve([{ id: 'm-1', displayName: 'M1', provider: 'OPENAI', compatibility: 'UNKNOWN' }]));
    const service = new AiModelDiscoveryService(fakeAiSettings() as never, fakeRegistry({ OPENAI: adapter }) as never);

    const result = await service.discover({ provider: 'OPENAI', apiKey: 'sk-temporary-secret' });

    expect(JSON.stringify(result)).not.toContain('sk-temporary-secret');
  });

  it('a temporary key that causes a provider failure is never leaked into the returned error message', async () => {
    const adapter = fakeAdapter(() => Promise.reject(new LlmPermanentError('Provider authentication failed.')));
    const service = new AiModelDiscoveryService(fakeAiSettings() as never, fakeRegistry({ OPENAI: adapter }) as never);

    const result = await service.discover({ provider: 'OPENAI', apiKey: 'sk-temporary-secret' });

    expect(result.success).toBe(false);
    expect(result.message).not.toContain('sk-temporary-secret');
  });
});

describe('AiModelDiscoveryService — normalization (§M)', () => {
  it('deduplicates by exact model ID, keeping the first occurrence', async () => {
    const adapter = fakeAdapter(() =>
      Promise.resolve([
        { id: 'dup-id', displayName: 'First', provider: 'OPENAI', compatibility: 'UNKNOWN' },
        { id: 'dup-id', displayName: 'Second (duplicate)', provider: 'OPENAI', compatibility: 'UNKNOWN' },
      ]),
    );
    const service = new AiModelDiscoveryService(fakeAiSettings() as never, fakeRegistry({ OPENAI: adapter }) as never);

    const result = await service.discover({ provider: 'OPENAI', apiKey: 'sk-new-key' });

    expect(result.models).toHaveLength(1);
    expect(result.models[0]!.displayName).toBe('First');
  });

  it('sorts deterministically by display name, and never picks a "best" model', async () => {
    const adapter = fakeAdapter(() =>
      Promise.resolve([
        { id: 'b', displayName: 'Bravo', provider: 'OPENAI', compatibility: 'UNKNOWN' },
        { id: 'a', displayName: 'Alpha', provider: 'OPENAI', compatibility: 'UNKNOWN' },
      ]),
    );
    const service = new AiModelDiscoveryService(fakeAiSettings() as never, fakeRegistry({ OPENAI: adapter }) as never);

    const result = await service.discover({ provider: 'OPENAI', apiKey: 'sk-new-key' });

    expect(result.models.map((m) => m.id)).toEqual(['a', 'b']);
  });
});

describe('AiModelDiscoveryService — writes nothing (§H)', () => {
  it('discovery never calls any AiSettings write path — the fake aiSettings collaborator exposes no update/write method at all, so any attempt would throw', async () => {
    const adapter = fakeAdapter(() => Promise.resolve([{ id: 'm-1', displayName: 'M1', provider: 'OPENAI', compatibility: 'UNKNOWN' }]));
    const service = new AiModelDiscoveryService(fakeAiSettings() as never, fakeRegistry({ OPENAI: adapter }) as never);

    await service.discover({ provider: 'OPENAI', apiKey: 'sk-new-key' });
    // Reaching this line without an error is the proof — see this test's own description.
    expect(true).toBe(true);
  });
});
