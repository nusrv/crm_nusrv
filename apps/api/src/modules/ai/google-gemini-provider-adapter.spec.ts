import { jest } from '@jest/globals';
import { GoogleGeminiProviderAdapter } from './google-gemini-provider-adapter';
import { buildClassificationInput } from './ai-context.util';
import { buildDraftReplyInput } from './ai-draft-context.util';
import { LlmMalformedOutputError, LlmPermanentError, LlmTransientError } from './llm-errors';
import type { LlmProviderAdapterConfig } from './llm-provider-adapter';

const REAL_API_KEY = 'AIza-super-secret-test-key';

function config(model = 'gemini-test-model'): LlmProviderAdapterConfig {
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

function candidateResponse(text: string, overrides: Record<string, unknown> = {}) {
  return { candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP', ...overrides }] };
}

describe('GoogleGeminiProviderAdapter (native fetch boundary)', () => {
  it('calls the Gemini generateContent endpoint with the resolved model in the URL path and the API key as a query parameter', async () => {
    const fetchImpl = jest.fn<typeof fetch>(() => Promise.resolve(fakeOkResponse(candidateResponse(JSON.stringify(validClassification)))));
    const adapter = new GoogleGeminiProviderAdapter();
    adapter.fetchImpl = fetchImpl;

    await adapter.classifyIntent(input(), config('gemini-model-v1'));

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url] = fetchImpl.mock.calls[0]! as [string, RequestInit];
    expect(url).toContain('/models/gemini-model-v1:generateContent');
    expect(url).toContain(`key=${REAL_API_KEY}`);
  });

  it('requests a JSON response format for classifyIntent/draftReply, but never for testConnection', async () => {
    const fetchImpl = jest.fn<typeof fetch>(() => Promise.resolve(fakeOkResponse(candidateResponse(JSON.stringify(validClassification)))));
    const adapter = new GoogleGeminiProviderAdapter();
    adapter.fetchImpl = fetchImpl;

    await adapter.classifyIntent(input(), config());
    const [, init] = fetchImpl.mock.calls[0]! as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { generationConfig: { responseMimeType?: string } };
    expect(body.generationConfig.responseMimeType).toBe('application/json');

    fetchImpl.mockClear();
    fetchImpl.mockResolvedValueOnce(fakeOkResponse(candidateResponse('OK')));
    await adapter.testConnection(config());
    const [, testInit] = fetchImpl.mock.calls[0]! as [string, RequestInit];
    const testBody = JSON.parse(testInit.body as string) as { generationConfig: { responseMimeType?: string } };
    expect(testBody.generationConfig.responseMimeType).toBeUndefined();
  });

  it('normalizes a valid JSON response into the exact classification contract', async () => {
    const fetchImpl = jest.fn(() => Promise.resolve(fakeOkResponse(candidateResponse(JSON.stringify(validClassification)))));
    const adapter = new GoogleGeminiProviderAdapter();
    adapter.fetchImpl = fetchImpl;

    const result = await adapter.classifyIntent(input(), config());

    expect(result.intent).toBe('ACCEPT_RENEWAL');
    expect(result.schemaVersion).toBe('phase3-intent-v1');
  });

  it('re-validates the response independently even though a JSON response format was requested — an unknown intent still fails', async () => {
    const fetchImpl = jest.fn(() =>
      Promise.resolve(fakeOkResponse(candidateResponse(JSON.stringify({ ...validClassification, intent: 'MADE_UP_INTENT' })))),
    );
    const adapter = new GoogleGeminiProviderAdapter();
    adapter.fetchImpl = fetchImpl;

    await expect(adapter.classifyIntent(input(), config())).rejects.toBeInstanceOf(LlmMalformedOutputError);
  });

  it('rejects when the response has no candidates at all (blocked/empty)', async () => {
    const fetchImpl = jest.fn(() => Promise.resolve(fakeOkResponse({ candidates: [] })));
    const adapter = new GoogleGeminiProviderAdapter();
    adapter.fetchImpl = fetchImpl;

    await expect(adapter.classifyIntent(input(), config())).rejects.toBeInstanceOf(LlmMalformedOutputError);
  });

  it('rejects when promptFeedback reports the request was blocked', async () => {
    const fetchImpl = jest.fn(() => Promise.resolve(fakeOkResponse({ promptFeedback: { blockReason: 'SAFETY' }, candidates: [] })));
    const adapter = new GoogleGeminiProviderAdapter();
    adapter.fetchImpl = fetchImpl;

    await expect(adapter.classifyIntent(input(), config())).rejects.toBeInstanceOf(LlmMalformedOutputError);
  });

  it.each(['SAFETY', 'RECITATION', 'PROHIBITED_CONTENT'] as const)(
    'rejects a %s finishReason as malformed output, never trusted, never business-actioned',
    async (finishReason) => {
      const fetchImpl = jest.fn(() => Promise.resolve(fakeOkResponse(candidateResponse('', { finishReason }))));
      const adapter = new GoogleGeminiProviderAdapter();
      adapter.fetchImpl = fetchImpl;

      await expect(adapter.classifyIntent(input(), config())).rejects.toBeInstanceOf(LlmMalformedOutputError);
    },
  );

  it('draftReply normalizes a valid JSON response into the exact draft contract', async () => {
    const fetchImpl = jest.fn(() => Promise.resolve(fakeOkResponse(candidateResponse(JSON.stringify(validDraft)))));
    const adapter = new GoogleGeminiProviderAdapter();
    adapter.fetchImpl = fetchImpl;

    const result = await adapter.draftReply(draftInput(), config());

    expect(result.bodyText).toBe(validDraft.bodyText);
    expect(result.schemaVersion).toBe('phase3-draft-v1');
  });

  it('draftReply rejects malformed/non-JSON output the same way as classifyIntent', async () => {
    const fetchImpl = jest.fn(() => Promise.resolve(fakeOkResponse(candidateResponse('not json at all'))));
    const adapter = new GoogleGeminiProviderAdapter();
    adapter.fetchImpl = fetchImpl;

    await expect(adapter.draftReply(draftInput(), config())).rejects.toBeInstanceOf(LlmMalformedOutputError);
  });

  it.each([
    [401, LlmPermanentError],
    [403, LlmPermanentError],
    [400, LlmPermanentError],
    [429, LlmTransientError],
    [500, LlmTransientError],
  ] as const)('maps HTTP status %d to %p, without ever reading the error response body', async (status, ErrorClass) => {
    const jsonSpy = jest.fn(() => Promise.reject(new Error('must never be called')));
    const fetchImpl = jest.fn(() => Promise.resolve({ ok: false, status, json: jsonSpy } as unknown as Response));
    const adapter = new GoogleGeminiProviderAdapter();
    adapter.fetchImpl = fetchImpl;

    await expect(adapter.classifyIntent(input(), config())).rejects.toBeInstanceOf(ErrorClass);
    expect(jsonSpy).not.toHaveBeenCalled();
  });

  it('maps a network/fetch-throw failure to a transient error', async () => {
    const fetchImpl = jest.fn(() => Promise.reject(new TypeError('fetch failed')));
    const adapter = new GoogleGeminiProviderAdapter();
    adapter.fetchImpl = fetchImpl;

    await expect(adapter.classifyIntent(input(), config())).rejects.toBeInstanceOf(LlmTransientError);
  });

  it('maps a timeout (AbortSignal.timeout firing) to a transient error', async () => {
    const timeoutError = new DOMException('The operation timed out.', 'TimeoutError');
    const fetchImpl = jest.fn(() => Promise.reject(timeoutError));
    const adapter = new GoogleGeminiProviderAdapter();
    adapter.fetchImpl = fetchImpl;

    await expect(adapter.classifyIntent(input(), config())).rejects.toBeInstanceOf(LlmTransientError);
  });

  it('passes an explicit AbortSignal-based timeout on every request', async () => {
    const fetchImpl = jest.fn<typeof fetch>(() => Promise.resolve(fakeOkResponse(candidateResponse(JSON.stringify(validClassification)))));
    const adapter = new GoogleGeminiProviderAdapter();
    adapter.fetchImpl = fetchImpl;

    await adapter.classifyIntent(input(), config());

    const [, init] = fetchImpl.mock.calls[0]! as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('never includes the API key in a thrown error message', async () => {
    const fetchImpl = jest.fn(() => Promise.resolve(fakeErrorResponse(401)));
    const adapter = new GoogleGeminiProviderAdapter();
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
      const fetchImpl = jest.fn(() => Promise.resolve(fakeOkResponse(candidateResponse('OK'))));
      const adapter = new GoogleGeminiProviderAdapter();
      adapter.fetchImpl = fetchImpl;

      const result = await adapter.testConnection(config());

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(typeof result.latencyMs).toBe('number');
    });

    it('normalizes a provider failure the same way as classifyIntent/draftReply', async () => {
      const fetchImpl = jest.fn(() => Promise.resolve(fakeErrorResponse(401)));
      const adapter = new GoogleGeminiProviderAdapter();
      adapter.fetchImpl = fetchImpl;

      await expect(adapter.testConnection(config())).rejects.toBeInstanceOf(LlmPermanentError);
    });
  });
});
