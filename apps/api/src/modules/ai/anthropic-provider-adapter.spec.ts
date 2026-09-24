import { jest } from '@jest/globals';
import { AnthropicProviderAdapter } from './anthropic-provider-adapter';
import { buildClassificationInput } from './ai-context.util';
import { buildDraftReplyInput } from './ai-draft-context.util';
import { LlmMalformedOutputError, LlmPermanentError, LlmTransientError } from './llm-errors';
import type { LlmProviderAdapterConfig } from './llm-provider-adapter';

const REAL_API_KEY = 'sk-ant-super-secret-test-key';

function config(model = 'claude-test-model'): LlmProviderAdapterConfig {
  return { model, apiKey: REAL_API_KEY };
}

function input() {
  return buildClassificationInput({ subject: 'Renewal', bodyText: 'yes please renew', occurredAt: new Date() }, []);
}

function draftInput() {
  return buildDraftReplyInput({ subject: 'Renewal notice', bodyText: 'yes please renew', occurredAt: new Date() }, [], null, null, null);
}

const validClassification = {
  intent: 'ACCEPT_RENEWAL',
  confidence: 0.95,
  requiresHumanReview: false,
  summary: 'Customer confirms.',
  language: 'en',
};

const validDraft = { bodyText: 'Thank you for your message. We will follow up shortly.', language: 'en' };

function fakeOkResponse(body: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve(body) } as Response;
}

function fakeErrorResponse(status: number) {
  return { ok: false, status, json: () => Promise.reject(new Error('should never be read on an error path')) } as Response;
}

function textResponse(text: string, overrides: Record<string, unknown> = {}) {
  return { content: [{ type: 'text', text }], stop_reason: 'end_turn', ...overrides };
}

describe('AnthropicProviderAdapter (native fetch boundary)', () => {
  it('calls the Anthropic Messages API with the resolved model, x-api-key header, and anthropic-version header', async () => {
    const fetchImpl = jest.fn<typeof fetch>(() => Promise.resolve(fakeOkResponse(textResponse(JSON.stringify(validClassification)))));
    const adapter = new AnthropicProviderAdapter();
    adapter.fetchImpl = fetchImpl;

    await adapter.classifyIntent(input(), config('claude-model-v1'));

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe(REAL_API_KEY);
    expect(headers['anthropic-version']).toBeTruthy();
    const body = JSON.parse(init.body as string) as { model: string; messages: Array<{ role: string; content: string }> };
    expect(body.model).toBe('claude-model-v1');
    expect(body.messages[0]!.role).toBe('user');
  });

  it('normalizes a valid JSON-text response into the exact classification contract', async () => {
    const fetchImpl = jest.fn(() => Promise.resolve(fakeOkResponse(textResponse(JSON.stringify(validClassification)))));
    const adapter = new AnthropicProviderAdapter();
    adapter.fetchImpl = fetchImpl;

    const result = await adapter.classifyIntent(input(), config());

    expect(result.intent).toBe('ACCEPT_RENEWAL');
    expect(result.schemaVersion).toBe('phase3-intent-v1');
  });

  it('extracts JSON even when the model wraps it in a markdown code fence', async () => {
    const fetchImpl = jest.fn(() =>
      Promise.resolve(fakeOkResponse(textResponse('```json\n' + JSON.stringify(validClassification) + '\n```'))),
    );
    const adapter = new AnthropicProviderAdapter();
    adapter.fetchImpl = fetchImpl;

    const result = await adapter.classifyIntent(input(), config());

    expect(result.intent).toBe('ACCEPT_RENEWAL');
  });

  it('rejects a plain-text refusal (not valid JSON) as malformed output, never trusted, never business-actioned', async () => {
    const fetchImpl = jest.fn(() => Promise.resolve(fakeOkResponse(textResponse("I can't help with that request."))));
    const adapter = new AnthropicProviderAdapter();
    adapter.fetchImpl = fetchImpl;

    await expect(adapter.classifyIntent(input(), config())).rejects.toBeInstanceOf(LlmMalformedOutputError);
  });

  it('rejects an explicit stop_reason: refusal without leaking any provider text', async () => {
    const refusalText = 'I will not help suspend a customer account.';
    const fetchImpl = jest.fn(() =>
      Promise.resolve(fakeOkResponse(textResponse(refusalText, { stop_reason: 'refusal' }))),
    );
    const adapter = new AnthropicProviderAdapter();
    adapter.fetchImpl = fetchImpl;

    expect.assertions(2);
    try {
      await adapter.classifyIntent(input(), config());
    } catch (error) {
      expect(error).toBeInstanceOf(LlmMalformedOutputError);
      expect((error as Error).message).not.toContain(refusalText);
    }
  });

  it('re-validates the extracted JSON against the real schema — an unknown intent fails even though JSON parsing succeeded', async () => {
    const fetchImpl = jest.fn(() =>
      Promise.resolve(fakeOkResponse(textResponse(JSON.stringify({ ...validClassification, intent: 'MADE_UP_INTENT' })))),
    );
    const adapter = new AnthropicProviderAdapter();
    adapter.fetchImpl = fetchImpl;

    await expect(adapter.classifyIntent(input(), config())).rejects.toBeInstanceOf(LlmMalformedOutputError);
  });

  it('draftReply normalizes a valid JSON-text response into the exact draft contract', async () => {
    const fetchImpl = jest.fn(() => Promise.resolve(fakeOkResponse(textResponse(JSON.stringify(validDraft)))));
    const adapter = new AnthropicProviderAdapter();
    adapter.fetchImpl = fetchImpl;

    const result = await adapter.draftReply(draftInput(), config());

    expect(result.bodyText).toBe(validDraft.bodyText);
    expect(result.schemaVersion).toBe('phase3-draft-v1');
  });

  it('draftReply rejects malformed/non-JSON output the same way as classifyIntent', async () => {
    const fetchImpl = jest.fn(() => Promise.resolve(fakeOkResponse(textResponse('not json at all'))));
    const adapter = new AnthropicProviderAdapter();
    adapter.fetchImpl = fetchImpl;

    await expect(adapter.draftReply(draftInput(), config())).rejects.toBeInstanceOf(LlmMalformedOutputError);
  });

  it.each([
    [401, LlmPermanentError],
    [403, LlmPermanentError],
    [400, LlmPermanentError],
    [429, LlmTransientError],
    [500, LlmTransientError],
    [529, LlmTransientError],
  ] as const)('maps HTTP status %d to %p, without ever reading the error response body', async (status, ErrorClass) => {
    const jsonSpy = jest.fn(() => Promise.reject(new Error('must never be called')));
    const fetchImpl = jest.fn(() => Promise.resolve({ ok: false, status, json: jsonSpy } as unknown as Response));
    const adapter = new AnthropicProviderAdapter();
    adapter.fetchImpl = fetchImpl;

    await expect(adapter.classifyIntent(input(), config())).rejects.toBeInstanceOf(ErrorClass);
    expect(jsonSpy).not.toHaveBeenCalled();
  });

  it('maps a network/fetch-throw failure to a transient error', async () => {
    const fetchImpl = jest.fn(() => Promise.reject(new TypeError('fetch failed')));
    const adapter = new AnthropicProviderAdapter();
    adapter.fetchImpl = fetchImpl;

    await expect(adapter.classifyIntent(input(), config())).rejects.toBeInstanceOf(LlmTransientError);
  });

  it('maps a timeout (AbortSignal.timeout firing) to a transient error', async () => {
    const timeoutError = new DOMException('The operation timed out.', 'TimeoutError');
    const fetchImpl = jest.fn(() => Promise.reject(timeoutError));
    const adapter = new AnthropicProviderAdapter();
    adapter.fetchImpl = fetchImpl;

    await expect(adapter.classifyIntent(input(), config())).rejects.toBeInstanceOf(LlmTransientError);
  });

  it('passes an explicit AbortSignal-based timeout on every request', async () => {
    const fetchImpl = jest.fn<typeof fetch>(() => Promise.resolve(fakeOkResponse(textResponse(JSON.stringify(validClassification)))));
    const adapter = new AnthropicProviderAdapter();
    adapter.fetchImpl = fetchImpl;

    await adapter.classifyIntent(input(), config());

    const [, init] = fetchImpl.mock.calls[0]! as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('never includes the API key in a thrown error message', async () => {
    const fetchImpl = jest.fn(() => Promise.resolve(fakeErrorResponse(401)));
    const adapter = new AnthropicProviderAdapter();
    adapter.fetchImpl = fetchImpl;

    expect.assertions(1);
    try {
      await adapter.classifyIntent(input(), config());
    } catch (error) {
      expect((error as Error).message).not.toContain(REAL_API_KEY);
    }
  });

  describe('testConnection (§K — Test AI)', () => {
    it('makes exactly one minimal round trip and reports latency, never classifying or drafting', async () => {
      const fetchImpl = jest.fn(() => Promise.resolve(fakeOkResponse(textResponse('OK'))));
      const adapter = new AnthropicProviderAdapter();
      adapter.fetchImpl = fetchImpl;

      const result = await adapter.testConnection(config());

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(typeof result.latencyMs).toBe('number');
    });

    it('normalizes a provider failure the same way as classifyIntent/draftReply', async () => {
      const fetchImpl = jest.fn(() => Promise.resolve(fakeErrorResponse(401)));
      const adapter = new AnthropicProviderAdapter();
      adapter.fetchImpl = fetchImpl;

      await expect(adapter.testConnection(config())).rejects.toBeInstanceOf(LlmPermanentError);
    });
  });
});
