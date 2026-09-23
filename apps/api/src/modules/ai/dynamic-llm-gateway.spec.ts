import { jest } from '@jest/globals';
import { DynamicLlmGateway } from './dynamic-llm-gateway';
import { LlmPermanentError } from './llm-errors';

function fakeAiSettings(settings: Partial<{ enabled: boolean; provider: string }>) {
  return {
    getSettings: () =>
      Promise.resolve({
        enabled: settings.enabled ?? false,
        provider: settings.provider ?? 'OPENAI',
        model: 'gpt-test',
        confidenceThreshold: 0.9,
        autoRouteAcceptEnabled: false,
        autoRouteAcceptCutoverAt: null,
      }),
  };
}

function input() {
  return { kind: 'untrusted_email_classification_input', currentMessage: { bodyText: 'x' } } as never;
}

describe('DynamicLlmGateway (Phase 3.1 §J correction)', () => {
  it('regression §6.1 — DB AI enabled + OpenAI configured NEVER silently uses mock because of AI_PROVIDER env: delegates to the real OpenAiLlmGateway regardless of what AI_PROVIDER is set to', async () => {
    // The whole point of this regression test: even though AI_PROVIDER in the real process
    // environment might still say 'mock' (a stale/legacy value nobody read), DynamicLlmGateway is
    // architecturally incapable of consulting it — it has no ConfigService dependency at all — so
    // it always routes to the real OpenAiLlmGateway once AiSettings says enabled+OPENAI.
    const aiSettings = fakeAiSettings({ enabled: true, provider: 'OPENAI' });
    const classifyIntent = jest.fn(() => Promise.resolve({ schemaVersion: 'v', intent: 'ACCEPT_RENEWAL', confidence: 0.9, requiresHumanReview: false, summary: '', language: 'en' }));
    const openai = { classifyIntent, draftReply: jest.fn() };
    const gateway = new DynamicLlmGateway(aiSettings as never, openai as never);

    const result = await gateway.classifyIntent(input());

    expect(classifyIntent).toHaveBeenCalledTimes(1);
    expect(result.intent).toBe('ACCEPT_RENEWAL');
  });

  it('throws LlmPermanentError (never mock, never a silent no-op) when AI is disabled', async () => {
    const aiSettings = fakeAiSettings({ enabled: false });
    const classifyIntent = jest.fn();
    const openai = { classifyIntent, draftReply: jest.fn() };
    const gateway = new DynamicLlmGateway(aiSettings as never, openai as never);

    await expect(gateway.classifyIntent(input())).rejects.toBeInstanceOf(LlmPermanentError);
    expect(classifyIntent).not.toHaveBeenCalled();
  });

  it('throws LlmPermanentError when provider is anything other than OPENAI, never falling back to mock', async () => {
    const aiSettings = fakeAiSettings({ enabled: true, provider: 'SOMETHING_ELSE' });
    const classifyIntent = jest.fn();
    const openai = { classifyIntent, draftReply: jest.fn() };
    const gateway = new DynamicLlmGateway(aiSettings as never, openai as never);

    await expect(gateway.classifyIntent(input())).rejects.toBeInstanceOf(LlmPermanentError);
    expect(classifyIntent).not.toHaveBeenCalled();
  });

  it('propagates OpenAiLlmGateway.classifyIntent()\'s own fail-closed error when model/key are missing (never mock)', async () => {
    const aiSettings = fakeAiSettings({ enabled: true, provider: 'OPENAI' });
    const classifyIntent = jest.fn(() => Promise.reject(new LlmPermanentError('AI model is not configured.')));
    const openai = { classifyIntent, draftReply: jest.fn() };
    const gateway = new DynamicLlmGateway(aiSettings as never, openai as never);

    await expect(gateway.classifyIntent(input())).rejects.toBeInstanceOf(LlmPermanentError);
  });

  it('draftReply follows the identical enabled/provider gate as classifyIntent', async () => {
    const aiSettings = fakeAiSettings({ enabled: true, provider: 'OPENAI' });
    const draftReply = jest.fn(() => Promise.resolve({ schemaVersion: 'v', bodyText: 'ok', language: 'en' }));
    const openai = { classifyIntent: jest.fn(), draftReply };
    const gateway = new DynamicLlmGateway(aiSettings as never, openai as never);

    await gateway.draftReply({} as never);

    expect(draftReply).toHaveBeenCalledTimes(1);
  });

  it('re-resolves settings on every call — a Settings-UI change (disable AI) takes effect on the very next call, no restart', async () => {
    let enabled = true;
    const aiSettings = { getSettings: () => Promise.resolve({ enabled, provider: 'OPENAI', model: 'gpt-test', confidenceThreshold: 0.9, autoRouteAcceptEnabled: false, autoRouteAcceptCutoverAt: null }) };
    const classifyIntent = jest.fn(() => Promise.resolve({ schemaVersion: 'v', intent: 'ACCEPT_RENEWAL', confidence: 0.9, requiresHumanReview: false, summary: '', language: 'en' }));
    const openai = { classifyIntent, draftReply: jest.fn() };
    const gateway = new DynamicLlmGateway(aiSettings as never, openai as never);

    await gateway.classifyIntent(input());
    enabled = false;
    await expect(gateway.classifyIntent(input())).rejects.toBeInstanceOf(LlmPermanentError);
    expect(classifyIntent).toHaveBeenCalledTimes(1);
  });
});
