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

/** Builds a candidate whose `content.parts` array is exactly the given parts, each optionally
 * marked `thought: true` — for exercising the live production correction's multi-part / thinking
 * handling, which a single-string `candidateResponse()` helper cannot express. */
function partsResponse(parts: Array<{ text: string; thought?: boolean }>, overrides: Record<string, unknown> = {}) {
  return { candidates: [{ content: { parts }, finishReason: 'STOP', ...overrides }] };
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

describe('GoogleGeminiProviderAdapter — thinking/multipart visible-output correction (live production fix)', () => {
  it('P1 — a visible answer in parts[0] (no thinking involved) still succeeds', async () => {
    const fetchImpl = jest.fn(() => Promise.resolve(fakeOkResponse(candidateResponse(JSON.stringify(validClassification)))));
    const adapter = new GoogleGeminiProviderAdapter();
    adapter.fetchImpl = fetchImpl;

    const result = await adapter.classifyIntent(input(), config());

    expect(result.intent).toBe('ACCEPT_RENEWAL');
  });

  it('P2 — multiple visible text parts concatenate correctly, in provider order', async () => {
    const json = JSON.stringify(validDraft);
    const fetchImpl = jest.fn(() =>
      Promise.resolve(fakeOkResponse(partsResponse([{ text: json.slice(0, 10) }, { text: json.slice(10) }]))),
    );
    const adapter = new GoogleGeminiProviderAdapter();
    adapter.fetchImpl = fetchImpl;

    const result = await adapter.draftReply(draftInput(), config());

    expect(result.bodyText).toBe(validDraft.bodyText);
  });

  it('P3 — a thought part followed by visible text succeeds, using only the visible text', async () => {
    const fetchImpl = jest.fn(() =>
      Promise.resolve(
        fakeOkResponse(
          partsResponse([
            { text: 'Let me think about this classification carefully...', thought: true },
            { text: JSON.stringify(validClassification) },
          ]),
        ),
      ),
    );
    const adapter = new GoogleGeminiProviderAdapter();
    adapter.fetchImpl = fetchImpl;

    const result = await adapter.classifyIntent(input(), config());

    expect(result.intent).toBe('ACCEPT_RENEWAL');
  });

  it('P4 — multiple thought parts followed by visible text succeeds', async () => {
    const fetchImpl = jest.fn(() =>
      Promise.resolve(
        fakeOkResponse(
          partsResponse([
            { text: 'First, I will consider the tone of the message.', thought: true },
            { text: 'Next, I will consider the explicit confirmation language.', thought: true },
            { text: JSON.stringify(validClassification) },
          ]),
        ),
      ),
    );
    const adapter = new GoogleGeminiProviderAdapter();
    adapter.fetchImpl = fetchImpl;

    const result = await adapter.classifyIntent(input(), config());

    expect(result.intent).toBe('ACCEPT_RENEWAL');
  });

  it('P5 — a thought-only response (no visible text at all) fails safely, never using thought content as output', async () => {
    const fetchImpl = jest.fn(() =>
      Promise.resolve(fakeOkResponse(partsResponse([{ text: 'Thinking forever about this...', thought: true }]))),
    );
    const adapter = new GoogleGeminiProviderAdapter();
    adapter.fetchImpl = fetchImpl;

    await expect(adapter.classifyIntent(input(), config())).rejects.toBeInstanceOf(LlmMalformedOutputError);
  });

  it('P6 — an empty parts array fails safely', async () => {
    const fetchImpl = jest.fn(() => Promise.resolve(fakeOkResponse(partsResponse([]))));
    const adapter = new GoogleGeminiProviderAdapter();
    adapter.fetchImpl = fetchImpl;

    await expect(adapter.classifyIntent(input(), config())).rejects.toBeInstanceOf(LlmMalformedOutputError);
  });

  it('P7 — a response missing candidates entirely fails safely (regression, already covered above — reasserted in this suite for completeness)', async () => {
    const fetchImpl = jest.fn(() => Promise.resolve(fakeOkResponse({ candidates: [] })));
    const adapter = new GoogleGeminiProviderAdapter();
    adapter.fetchImpl = fetchImpl;

    await expect(adapter.classifyIntent(input(), config())).rejects.toBeInstanceOf(LlmMalformedOutputError);
  });

  it('P8 — the live production root cause: MAX_TOKENS with no usable visible answer produces a specific, safe budget-exhaustion error, never the generic "no text content" message', async () => {
    const fetchImpl = jest.fn(() => Promise.resolve(fakeOkResponse(partsResponse([], { finishReason: 'MAX_TOKENS' }))));
    const adapter = new GoogleGeminiProviderAdapter();
    adapter.fetchImpl = fetchImpl;

    expect.assertions(2);
    try {
      await adapter.testConnection(config());
    } catch (error) {
      expect(error).toBeInstanceOf(LlmMalformedOutputError);
      expect((error as Error).message).toBe('Provider exhausted the generation budget before producing usable output.');
    }
  });

  it('P8b — MAX_TOKENS reached after thinking alone consumed the whole budget (no content field at all) also produces the budget-exhaustion error', async () => {
    const fetchImpl = jest.fn(() => Promise.resolve(fakeOkResponse({ candidates: [{ finishReason: 'MAX_TOKENS' }] })));
    const adapter = new GoogleGeminiProviderAdapter();
    adapter.fetchImpl = fetchImpl;

    await expect(adapter.testConnection(config())).rejects.toThrow(
      'Provider exhausted the generation budget before producing usable output.',
    );
  });

  it.each(['SAFETY', 'RECITATION', 'PROHIBITED_CONTENT'] as const)(
    'P9/P10/P11 — %s remains safely handled exactly as before this correction',
    async (finishReason) => {
      const fetchImpl = jest.fn(() => Promise.resolve(fakeOkResponse(partsResponse([], { finishReason }))));
      const adapter = new GoogleGeminiProviderAdapter();
      adapter.fetchImpl = fetchImpl;

      await expect(adapter.classifyIntent(input(), config())).rejects.toBeInstanceOf(LlmMalformedOutputError);
    },
  );

  it('P12 — testConnection no longer uses the unsafe 16-token budget', async () => {
    const fetchImpl = jest.fn<typeof fetch>(() => Promise.resolve(fakeOkResponse(candidateResponse('OK'))));
    const adapter = new GoogleGeminiProviderAdapter();
    adapter.fetchImpl = fetchImpl;

    await adapter.testConnection(config());

    const [, init] = fetchImpl.mock.calls[0]! as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { generationConfig: { maxOutputTokens: number } };
    expect(body.generationConfig.maxOutputTokens).toBeGreaterThan(16);
    expect(body.generationConfig.maxOutputTokens).toBeLessThanOrEqual(2048); // still explicitly bounded, never unbounded.
  });

  it('P13 — a thought-only response can never count as a successful connectivity test', async () => {
    const fetchImpl = jest.fn(() =>
      Promise.resolve(fakeOkResponse(partsResponse([{ text: 'Thinking about how to say OK...', thought: true }]))),
    );
    const adapter = new GoogleGeminiProviderAdapter();
    adapter.fetchImpl = fetchImpl;

    await expect(adapter.testConnection(config())).rejects.toBeInstanceOf(LlmMalformedOutputError);
  });

  it('P14 — classifyIntent normalizes correctly with thought parts preceding the visible JSON', async () => {
    const fetchImpl = jest.fn(() =>
      Promise.resolve(
        fakeOkResponse(partsResponse([{ text: 'reasoning...', thought: true }, { text: JSON.stringify(validClassification) }])),
      ),
    );
    const adapter = new GoogleGeminiProviderAdapter();
    adapter.fetchImpl = fetchImpl;

    const result = await adapter.classifyIntent(input(), config());

    expect(result).toEqual({ schemaVersion: 'phase3-intent-v1', ...validClassification });
  });

  it('P15 — draftReply normalizes correctly with thought parts preceding the visible JSON', async () => {
    const fetchImpl = jest.fn(() =>
      Promise.resolve(fakeOkResponse(partsResponse([{ text: 'reasoning...', thought: true }, { text: JSON.stringify(validDraft) }]))),
    );
    const adapter = new GoogleGeminiProviderAdapter();
    adapter.fetchImpl = fetchImpl;

    const result = await adapter.draftReply(draftInput(), config());

    expect(result).toEqual({ schemaVersion: 'phase3-draft-v1', ...validDraft });
  });

  it('P16 — strict classification Zod validation is unchanged: an unknown intent still fails even with a thought part present', async () => {
    const fetchImpl = jest.fn(() =>
      Promise.resolve(
        fakeOkResponse(
          partsResponse([
            { text: 'reasoning...', thought: true },
            { text: JSON.stringify({ ...validClassification, intent: 'MADE_UP_INTENT' }) },
          ]),
        ),
      ),
    );
    const adapter = new GoogleGeminiProviderAdapter();
    adapter.fetchImpl = fetchImpl;

    await expect(adapter.classifyIntent(input(), config())).rejects.toBeInstanceOf(LlmMalformedOutputError);
  });

  it('P17 — strict draft Zod validation is unchanged: an unexpected extra key still fails even with a thought part present', async () => {
    const fetchImpl = jest.fn(() =>
      Promise.resolve(
        fakeOkResponse(
          partsResponse([{ text: 'reasoning...', thought: true }, { text: JSON.stringify({ ...validDraft, confidence: 0.9 }) }]),
        ),
      ),
    );
    const adapter = new GoogleGeminiProviderAdapter();
    adapter.fetchImpl = fetchImpl;

    await expect(adapter.draftReply(draftInput(), config())).rejects.toBeInstanceOf(LlmMalformedOutputError);
  });

  it('P18 — thought content never reaches the normalized classification/draft output', async () => {
    const thoughtText = 'SECRET_INTERNAL_REASONING_MUST_NEVER_LEAK';
    const fetchImpl = jest.fn(() =>
      Promise.resolve(fakeOkResponse(partsResponse([{ text: thoughtText, thought: true }, { text: JSON.stringify(validDraft) }]))),
    );
    const adapter = new GoogleGeminiProviderAdapter();
    adapter.fetchImpl = fetchImpl;

    const result = await adapter.draftReply(draftInput(), config());

    expect(JSON.stringify(result)).not.toContain(thoughtText);
  });

  it('P19 — thought content never appears in a thrown error message (never logged/persisted via an error path)', async () => {
    const thoughtText = 'SECRET_INTERNAL_REASONING_MUST_NEVER_LEAK';
    const fetchImpl = jest.fn(() => Promise.resolve(fakeOkResponse(partsResponse([{ text: thoughtText, thought: true }]))));
    const adapter = new GoogleGeminiProviderAdapter();
    adapter.fetchImpl = fetchImpl;

    expect.assertions(1);
    try {
      await adapter.classifyIntent(input(), config());
    } catch (error) {
      expect((error as Error).message).not.toContain(thoughtText);
    }
  });

  it('P20 — Gemini errors remain sanitized in this exact scenario class (network failure while a thinking-capable model is selected)', async () => {
    const fetchImpl = jest.fn(() => Promise.reject(new TypeError('fetch failed')));
    const adapter = new GoogleGeminiProviderAdapter();
    adapter.fetchImpl = fetchImpl;

    await expect(adapter.testConnection(config('gemini-flash-latest'))).rejects.toBeInstanceOf(LlmTransientError);
  });
});

describe('GoogleGeminiProviderAdapter.listModels (dynamic model discovery)', () => {
  it('normalizes the model-list response and strips the "models/" name prefix to match request()\'s expected ID form', async () => {
    const fetchImpl = jest.fn<typeof fetch>(() =>
      Promise.resolve(
        fakeOkResponse({
          models: [
            {
              name: 'models/gemini-test-pro',
              displayName: 'Gemini Test Pro',
              description: 'A test model.',
              inputTokenLimit: 1000,
              outputTokenLimit: 500,
              supportedGenerationMethods: ['generateContent'],
            },
          ],
        }),
      ),
    );
    const adapter = new GoogleGeminiProviderAdapter();
    adapter.fetchImpl = fetchImpl;

    const models = await adapter.listModels(REAL_API_KEY);

    expect(models).toEqual([
      {
        id: 'gemini-test-pro',
        displayName: 'Gemini Test Pro',
        provider: 'GOOGLE_GEMINI',
        compatibility: 'COMPATIBLE',
        metadata: { description: 'A test model.', inputTokenLimit: 1000, outputTokenLimit: 500 },
      },
    ]);
  });

  it('excludes a model whose metadata explicitly does not list generateContent (e.g. an embeddings-only model)', async () => {
    const fetchImpl = jest.fn<typeof fetch>(() =>
      Promise.resolve(
        fakeOkResponse({
          models: [
            { name: 'models/gemini-test-pro', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/text-embedding-test', supportedGenerationMethods: ['embedContent'] },
          ],
        }),
      ),
    );
    const adapter = new GoogleGeminiProviderAdapter();
    adapter.fetchImpl = fetchImpl;

    const models = await adapter.listModels(REAL_API_KEY);

    expect(models.map((m) => m.id)).toEqual(['gemini-test-pro']);
  });

  it('includes a model with no supportedGenerationMethods metadata at all as UNKNOWN, never guessed/excluded', async () => {
    const fetchImpl = jest.fn<typeof fetch>(() =>
      Promise.resolve(fakeOkResponse({ models: [{ name: 'models/gemini-mystery' }] })),
    );
    const adapter = new GoogleGeminiProviderAdapter();
    adapter.fetchImpl = fetchImpl;

    const models = await adapter.listModels(REAL_API_KEY);

    expect(models).toEqual([{ id: 'gemini-mystery', displayName: 'models/gemini-mystery', provider: 'GOOGLE_GEMINI', compatibility: 'UNKNOWN', metadata: { description: undefined, inputTokenLimit: undefined, outputTokenLimit: undefined } }]);
  });

  it('follows documented pageToken/nextPageToken pagination across multiple pages', async () => {
    const fetchImpl = jest.fn<(url: string, init?: RequestInit) => Promise<Response>>((url) => {
      const hasToken = url.includes('pageToken=page-2');
      if (!hasToken) {
        return Promise.resolve(
          fakeOkResponse({ models: [{ name: 'models/model-a', supportedGenerationMethods: ['generateContent'] }], nextPageToken: 'page-2' }),
        );
      }
      return Promise.resolve(fakeOkResponse({ models: [{ name: 'models/model-b', supportedGenerationMethods: ['generateContent'] }] }));
    });
    const adapter = new GoogleGeminiProviderAdapter();
    adapter.fetchImpl = fetchImpl as never;

    const models = await adapter.listModels(REAL_API_KEY);

    expect(models.map((m) => m.id)).toEqual(['model-a', 'model-b']);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('never loops forever when nextPageToken keeps repeating the same value', async () => {
    const fetchImpl = jest.fn<typeof fetch>(() =>
      Promise.resolve(fakeOkResponse({ models: [{ name: 'models/stuck', supportedGenerationMethods: ['generateContent'] }], nextPageToken: 'same-token' })),
    );
    const adapter = new GoogleGeminiProviderAdapter();
    adapter.fetchImpl = fetchImpl;

    const models = await adapter.listModels(REAL_API_KEY);

    expect(fetchImpl.mock.calls.length).toBeLessThanOrEqual(10);
    expect(models.length).toBeGreaterThan(0);
  });

  it('provider errors are sanitized identically to classifyIntent/draftReply/testConnection', async () => {
    const fetchImpl = jest.fn<typeof fetch>(() => Promise.resolve(fakeErrorResponse(401)));
    const adapter = new GoogleGeminiProviderAdapter();
    adapter.fetchImpl = fetchImpl;

    await expect(adapter.listModels(REAL_API_KEY)).rejects.toBeInstanceOf(LlmPermanentError);
  });
});
