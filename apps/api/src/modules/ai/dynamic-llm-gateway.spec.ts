import { jest } from '@jest/globals';
import { DynamicLlmGateway } from './dynamic-llm-gateway';
import { LlmPermanentError } from './llm-errors';

function fakeAiSettings(settings: Partial<{ enabled: boolean; provider: string; model: string | null }>, apiKey: string | null = 'secret-key') {
  return {
    getSettings: () =>
      Promise.resolve({
        enabled: settings.enabled ?? false,
        provider: settings.provider ?? 'OPENAI',
        model: settings.model === undefined ? 'gpt-test' : settings.model,
        confidenceThreshold: 0.9,
        autoRouteAcceptEnabled: false,
        autoRouteAcceptCutoverAt: null,
      }),
    getApiKey: () => Promise.resolve(apiKey),
  };
}

function fakeAdapter() {
  return {
    classifyIntent: jest.fn(() => Promise.resolve({ schemaVersion: 'v', intent: 'ACCEPT_RENEWAL', confidence: 0.9, requiresHumanReview: false, summary: '', language: 'en' })),
    draftReply: jest.fn(() => Promise.resolve({ schemaVersion: 'v', bodyText: 'ok', language: 'en' })),
    testConnection: jest.fn(() => Promise.resolve({ latencyMs: 1 })),
  };
}

function fakeRegistry(adapters: Record<string, ReturnType<typeof fakeAdapter> | undefined>) {
  return { resolve: (provider: string) => adapters[provider] ?? null };
}

function input() {
  return { kind: 'untrusted_email_classification_input', currentMessage: { bodyText: 'x' } } as never;
}

describe('DynamicLlmGateway (provider-neutral correction)', () => {
  it('P1/regression §6.1 — OPENAI resolves and delegates to the OpenAI adapter only, regardless of any AI_PROVIDER env value that might exist', async () => {
    const aiSettings = fakeAiSettings({ enabled: true, provider: 'OPENAI' });
    const openai = fakeAdapter();
    const anthropic = fakeAdapter();
    const registry = fakeRegistry({ OPENAI: openai, ANTHROPIC: anthropic });
    const gateway = new DynamicLlmGateway(aiSettings as never, registry as never);

    const result = await gateway.classifyIntent(input());

    expect(openai.classifyIntent).toHaveBeenCalledTimes(1);
    expect(anthropic.classifyIntent).not.toHaveBeenCalled();
    expect(result.intent).toBe('ACCEPT_RENEWAL');
  });

  it('P2 — ANTHROPIC resolves and delegates to the Anthropic adapter only', async () => {
    const aiSettings = fakeAiSettings({ enabled: true, provider: 'ANTHROPIC' });
    const openai = fakeAdapter();
    const anthropic = fakeAdapter();
    const registry = fakeRegistry({ OPENAI: openai, ANTHROPIC: anthropic });
    const gateway = new DynamicLlmGateway(aiSettings as never, registry as never);

    await gateway.classifyIntent(input());

    expect(anthropic.classifyIntent).toHaveBeenCalledTimes(1);
    expect(openai.classifyIntent).not.toHaveBeenCalled();
  });

  it('P3 — GOOGLE_GEMINI resolves and delegates to the Gemini adapter only', async () => {
    const aiSettings = fakeAiSettings({ enabled: true, provider: 'GOOGLE_GEMINI' });
    const gemini = fakeAdapter();
    const registry = fakeRegistry({ GOOGLE_GEMINI: gemini });
    const gateway = new DynamicLlmGateway(aiSettings as never, registry as never);

    await gateway.classifyIntent(input());

    expect(gemini.classifyIntent).toHaveBeenCalledTimes(1);
  });

  it('§C — resolves settings ONCE and passes the resolved model/apiKey down to the adapter explicitly', async () => {
    const aiSettings = fakeAiSettings({ enabled: true, provider: 'OPENAI', model: 'gpt-specific-model' }, 'sk-specific-key');
    const openai = fakeAdapter();
    const registry = fakeRegistry({ OPENAI: openai });
    const gateway = new DynamicLlmGateway(aiSettings as never, registry as never);

    await gateway.classifyIntent(input());

    expect(openai.classifyIntent).toHaveBeenCalledWith(input(), { model: 'gpt-specific-model', apiKey: 'sk-specific-key' });
  });

  it('throws LlmPermanentError (never mock, never a silent no-op) when AI is disabled', async () => {
    const aiSettings = fakeAiSettings({ enabled: false });
    const openai = fakeAdapter();
    const registry = fakeRegistry({ OPENAI: openai });
    const gateway = new DynamicLlmGateway(aiSettings as never, registry as never);

    await expect(gateway.classifyIntent(input())).rejects.toBeInstanceOf(LlmPermanentError);
    expect(openai.classifyIntent).not.toHaveBeenCalled();
  });

  it('P4/regression — an unsupported/unknown provider string fails closed via the registry, never falling back to any default adapter', async () => {
    const aiSettings = fakeAiSettings({ enabled: true, provider: 'SOMETHING_ELSE' });
    const registry = fakeRegistry({});
    const gateway = new DynamicLlmGateway(aiSettings as never, registry as never);

    await expect(gateway.classifyIntent(input())).rejects.toBeInstanceOf(LlmPermanentError);
  });

  it('fails closed when enabled+valid provider but no model is configured', async () => {
    const aiSettings = fakeAiSettings({ enabled: true, provider: 'OPENAI', model: null });
    const openai = fakeAdapter();
    const registry = fakeRegistry({ OPENAI: openai });
    const gateway = new DynamicLlmGateway(aiSettings as never, registry as never);

    await expect(gateway.classifyIntent(input())).rejects.toBeInstanceOf(LlmPermanentError);
    expect(openai.classifyIntent).not.toHaveBeenCalled();
  });

  it('fails closed when enabled+valid provider+model but no API key is configured', async () => {
    const aiSettings = fakeAiSettings({ enabled: true, provider: 'OPENAI' }, null);
    const openai = fakeAdapter();
    const registry = fakeRegistry({ OPENAI: openai });
    const gateway = new DynamicLlmGateway(aiSettings as never, registry as never);

    await expect(gateway.classifyIntent(input())).rejects.toBeInstanceOf(LlmPermanentError);
    expect(openai.classifyIntent).not.toHaveBeenCalled();
  });

  it('draftReply follows the identical enabled/provider/model/key gate as classifyIntent', async () => {
    const aiSettings = fakeAiSettings({ enabled: true, provider: 'ANTHROPIC' });
    const anthropic = fakeAdapter();
    const registry = fakeRegistry({ ANTHROPIC: anthropic });
    const gateway = new DynamicLlmGateway(aiSettings as never, registry as never);

    await gateway.draftReply({} as never);

    expect(anthropic.draftReply).toHaveBeenCalledTimes(1);
  });

  it('P5 — re-resolves settings on every call: a Settings-UI provider/enable change takes effect on the very next call, no restart', async () => {
    let enabled = true;
    let provider = 'OPENAI';
    const aiSettings = {
      getSettings: () =>
        Promise.resolve({ enabled, provider, model: 'gpt-test', confidenceThreshold: 0.9, autoRouteAcceptEnabled: false, autoRouteAcceptCutoverAt: null }),
      getApiKey: () => Promise.resolve('secret-key'),
    };
    const openai = fakeAdapter();
    const anthropic = fakeAdapter();
    const registry = fakeRegistry({ OPENAI: openai, ANTHROPIC: anthropic });
    const gateway = new DynamicLlmGateway(aiSettings as never, registry as never);

    await gateway.classifyIntent(input());
    expect(openai.classifyIntent).toHaveBeenCalledTimes(1);

    provider = 'ANTHROPIC';
    await gateway.classifyIntent(input());
    expect(anthropic.classifyIntent).toHaveBeenCalledTimes(1);
    expect(openai.classifyIntent).toHaveBeenCalledTimes(1); // unchanged — no longer routed to OpenAI.

    enabled = false;
    await expect(gateway.classifyIntent(input())).rejects.toBeInstanceOf(LlmPermanentError);
  });
});
