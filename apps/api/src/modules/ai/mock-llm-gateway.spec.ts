import { AiIntent } from '../../generated/prisma/enums';
import { buildClassificationInput } from './ai-context.util';
import { buildDraftReplyInput } from './ai-draft-context.util';
import { LlmMalformedOutputError, LlmPermanentError, LlmTransientError } from './llm-errors';
import { MockLlmGateway } from './mock-llm-gateway';
import { DRAFT_RESULT_SCHEMA_VERSION, RESULT_SCHEMA_VERSION } from './llm-gateway';
import type { DraftReplyInput } from './llm-gateway';

function input(bodyText: string) {
  return buildClassificationInput({ subject: 'Renewal', bodyText, occurredAt: new Date() }, []);
}

function draftInput(bodyText: string, intent: string | null = null): DraftReplyInput {
  return buildDraftReplyInput(
    { subject: 'Renewal notice', bodyText, occurredAt: new Date() },
    [],
    intent ? { source: 'AI', intent, summary: 'summary', language: 'en' } : null,
    null,
    null,
  );
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

describe('MockLlmGateway.draftReply (Slice F §20)', () => {
  it('is network-free and deterministic: the same input always yields the same output', async () => {
    const gateway = new MockLlmGateway();
    const a = await gateway.draftReply(draftInput('hello'));
    const b = await gateway.draftReply(draftInput('hello'));
    expect(a).toEqual(b);
  });

  it('English inbound produces an English draft, tagged with the draft schema version', async () => {
    const gateway = new MockLlmGateway();
    const result = await gateway.draftReply(draftInput('Can you help me with my renewal?'));
    expect(result.language).toBe('en');
    expect(result.schemaVersion).toBe(DRAFT_RESULT_SCHEMA_VERSION);
    expect(result.bodyText.length).toBeGreaterThan(0);
  });

  it('Arabic inbound (no classification language) produces an Arabic draft', async () => {
    const gateway = new MockLlmGateway();
    const result = await gateway.draftReply(draftInput('هل يمكنكم مساعدتي في التجديد؟'));
    expect(result.language).toBe('ar');
    expect(result.bodyText).toMatch(/[؀-ۿ]/);
  });

  it('REQUEST_INVOICE — never claims the invoice has already been issued/sent', async () => {
    const gateway = new MockLlmGateway();
    const result = await gateway.draftReply(draftInput('please send invoice', AiIntent.REQUEST_INVOICE));
    expect(result.bodyText.toLowerCase()).not.toMatch(/invoice (has been|was) (issued|sent)/);
  });

  it('PAYMENT_REPORTED — never claims the payment has been received/confirmed', async () => {
    const gateway = new MockLlmGateway();
    const result = await gateway.draftReply(draftInput('i already paid', AiIntent.PAYMENT_REPORTED));
    expect(result.bodyText.toLowerCase()).not.toMatch(/payment (has been|was) (received|confirmed)/);
  });

  it('PRICE_DISPUTE — never invents a specific new price or discount figure', async () => {
    const gateway = new MockLlmGateway();
    const result = await gateway.draftReply(draftInput('too expensive', AiIntent.PRICE_DISPUTE));
    expect(result.bodyText).not.toMatch(/\$\d|\d+%/);
  });

  it('COMPLAINT — acknowledges professionally without fabricating a resolution', async () => {
    const gateway = new MockLlmGateway();
    const result = await gateway.draftReply(draftInput('this is unacceptable', AiIntent.COMPLAINT));
    expect(result.bodyText.length).toBeGreaterThan(0);
    expect(result.bodyText.toLowerCase()).not.toMatch(/resolved|fixed|refund(ed)?/);
  });

  it('ACCEPT_RENEWAL — never claims the renewal is already completed', async () => {
    const gateway = new MockLlmGateway();
    const result = await gateway.draftReply(draftInput('yes go ahead', AiIntent.ACCEPT_RENEWAL));
    expect(result.bodyText.toLowerCase()).not.toMatch(/renewal (is|has been) (complete|finalized|processed)/);
  });

  it('REJECT_RENEWAL — never claims the service is already cancelled/suspended', async () => {
    const gateway = new MockLlmGateway();
    const result = await gateway.draftReply(draftInput('cancel it', AiIntent.REJECT_RENEWAL));
    expect(result.bodyText.toLowerCase()).not.toMatch(/(cancelled|suspended)/);
  });

  it('§20 — draftReplyImpl test seam supports a transient failure scenario', async () => {
    const gateway = new MockLlmGateway();
    gateway.draftReplyImpl = () => Promise.reject(new LlmTransientError('rate limited'));
    await expect(gateway.draftReply(draftInput('x'))).rejects.toBeInstanceOf(LlmTransientError);
  });

  it('§20 — draftReplyImpl test seam supports a permanent failure scenario', async () => {
    const gateway = new MockLlmGateway();
    gateway.draftReplyImpl = () => Promise.reject(new LlmPermanentError('invalid api key'));
    await expect(gateway.draftReply(draftInput('x'))).rejects.toBeInstanceOf(LlmPermanentError);
  });

  it('§20 — draftReplyImpl test seam supports a malformed-output scenario', async () => {
    const gateway = new MockLlmGateway();
    gateway.draftReplyImpl = () => Promise.reject(new LlmMalformedOutputError('bad json'));
    await expect(gateway.draftReply(draftInput('x'))).rejects.toBeInstanceOf(LlmMalformedOutputError);
  });

  it('never generates a fake send/business action string — output is body text plus language only', async () => {
    const gateway = new MockLlmGateway();
    const result = await gateway.draftReply(draftInput('hello'));
    expect(Object.keys(result).sort()).toEqual(['bodyText', 'language', 'schemaVersion']);
  });
});
