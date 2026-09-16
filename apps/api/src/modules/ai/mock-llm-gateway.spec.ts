import { AiIntent } from '../../generated/prisma/enums';
import { buildClassificationInput } from './ai-context.util';
import { LlmMalformedOutputError, LlmPermanentError, LlmTransientError } from './llm-errors';
import { MockLlmGateway } from './mock-llm-gateway';
import { RESULT_SCHEMA_VERSION } from './llm-gateway';

function input(bodyText: string) {
  return buildClassificationInput({ subject: 'Renewal', bodyText, occurredAt: new Date() }, []);
}

describe('MockLlmGateway', () => {
  it('is network-free and deterministic: the same input always yields the same output', async () => {
    const gateway = new MockLlmGateway();
    const a = await gateway.classifyIntent(input('yes please renew'));
    const b = await gateway.classifyIntent(input('yes please renew'));
    expect(a).toEqual(b);
  });

  it('§26 — high-confidence classification', async () => {
    const gateway = new MockLlmGateway();
    const result = await gateway.classifyIntent(input('yes please renew, go ahead'));
    expect(result.intent).toBe(AiIntent.ACCEPT_RENEWAL);
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    expect(result.schemaVersion).toBe(RESULT_SCHEMA_VERSION);
  });

  it('§26 — low-confidence classification (test seam override)', async () => {
    const gateway = new MockLlmGateway();
    gateway.classifyIntentImpl = () =>
      Promise.resolve({
        schemaVersion: RESULT_SCHEMA_VERSION,
        intent: AiIntent.OTHER,
        confidence: 0.4,
        requiresHumanReview: false,
        summary: 'low confidence',
        language: 'en',
      });
    const result = await gateway.classifyIntent(input('hmm'));
    expect(result.confidence).toBe(0.4);
  });

  it('§26 — UNCLEAR', async () => {
    const gateway = new MockLlmGateway();
    const result = await gateway.classifyIntent(input(''));
    expect(result.intent).toBe(AiIntent.UNCLEAR);
  });

  it('§26 — provider-requested human review even with a valid, well-formed intent', async () => {
    const gateway = new MockLlmGateway();
    gateway.classifyIntentImpl = () =>
      Promise.resolve({
        schemaVersion: RESULT_SCHEMA_VERSION,
        intent: AiIntent.ACCEPT_RENEWAL,
        confidence: 0.99,
        requiresHumanReview: true,
        summary: 'provider flagged for review',
        language: 'en',
      });
    const result = await gateway.classifyIntent(input('yes'));
    expect(result.requiresHumanReview).toBe(true);
  });

  it('§26 — transient failure', async () => {
    const gateway = new MockLlmGateway();
    gateway.classifyIntentImpl = () => Promise.reject(new LlmTransientError('rate limited'));
    await expect(gateway.classifyIntent(input('x'))).rejects.toBeInstanceOf(LlmTransientError);
  });

  it('§26 — auth/permanent failure', async () => {
    const gateway = new MockLlmGateway();
    gateway.classifyIntentImpl = () => Promise.reject(new LlmPermanentError('invalid api key'));
    await expect(gateway.classifyIntent(input('x'))).rejects.toBeInstanceOf(LlmPermanentError);
  });

  it('§26 — malformed structured output', async () => {
    const gateway = new MockLlmGateway();
    gateway.classifyIntentImpl = () => Promise.reject(new LlmMalformedOutputError('bad json'));
    await expect(gateway.classifyIntent(input('x'))).rejects.toBeInstanceOf(LlmMalformedOutputError);
  });

  it('§26 — delayed/concurrent responses resolve independently and correctly', async () => {
    const gateway = new MockLlmGateway();
    let callCount = 0;
    gateway.classifyIntentImpl = async (received) => {
      const myCall = ++callCount;
      await new Promise((resolve) => setTimeout(resolve, myCall === 1 ? 20 : 1));
      return {
        schemaVersion: RESULT_SCHEMA_VERSION,
        intent: AiIntent.OTHER,
        confidence: 0.8,
        requiresHumanReview: false,
        summary: `call ${myCall} for ${received.current.bodyText}`,
        language: 'en',
      };
    };
    const [first, second] = await Promise.all([gateway.classifyIntent(input('first')), gateway.classifyIntent(input('second'))]);
    expect(first.summary).toContain('first');
    expect(second.summary).toContain('second');
  });

  it('never accepts/uses a credential — the mock has no constructor dependency at all', () => {
    const gateway = new MockLlmGateway();
    expect(Object.keys(gateway)).not.toContain('apiKey');
    expect(gateway.constructor.length).toBe(0);
  });
});
