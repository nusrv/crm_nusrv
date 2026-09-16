import { rawClassificationOutputSchema } from './ai-classification-schema';

const valid = {
  intent: 'ACCEPT_RENEWAL',
  confidence: 0.95,
  requiresHumanReview: false,
  summary: 'Customer confirms renewal.',
  language: 'en',
};

describe('rawClassificationOutputSchema', () => {
  it('accepts a fully valid structured output', () => {
    expect(rawClassificationOutputSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts every frozen AiIntent value', () => {
    const intents = [
      'ACCEPT_RENEWAL',
      'REJECT_RENEWAL',
      'REQUEST_INVOICE',
      'PAYMENT_REPORTED',
      'REQUEST_UPGRADE',
      'REQUEST_DOWNGRADE',
      'REQUEST_CLARIFICATION',
      'PRICE_DISPUTE',
      'COMPLAINT',
      'OTHER',
      'UNCLEAR',
    ];
    for (const intent of intents) {
      expect(rawClassificationOutputSchema.safeParse({ ...valid, intent }).success).toBe(true);
    }
  });

  it('rejects an unknown/invented intent string — never a synonym, never passed through', () => {
    const result = rawClassificationOutputSchema.safeParse({ ...valid, intent: 'ACCEPT' });
    expect(result.success).toBe(false);
  });

  it('rejects confidence outside 0..1', () => {
    expect(rawClassificationOutputSchema.safeParse({ ...valid, confidence: 1.5 }).success).toBe(false);
    expect(rawClassificationOutputSchema.safeParse({ ...valid, confidence: -0.1 }).success).toBe(false);
  });

  it('accepts confidence at the exact boundaries 0 and 1', () => {
    expect(rawClassificationOutputSchema.safeParse({ ...valid, confidence: 0 }).success).toBe(true);
    expect(rawClassificationOutputSchema.safeParse({ ...valid, confidence: 1 }).success).toBe(true);
  });

  it('rejects a non-boolean requiresHumanReview', () => {
    expect(rawClassificationOutputSchema.safeParse({ ...valid, requiresHumanReview: 'false' }).success).toBe(false);
  });

  it('rejects missing required fields', () => {
    const { summary: _summary, ...withoutSummary } = valid;
    void _summary;
    expect(rawClassificationOutputSchema.safeParse(withoutSummary).success).toBe(false);
  });

  it('rejects unexpected extra keys (.strict()) — defense against a provider smuggling extra fields', () => {
    const result = rawClassificationOutputSchema.safeParse({ ...valid, toolCall: { name: 'suspend_service' } });
    expect(result.success).toBe(false);
  });

  it('rejects completely malformed input (not an object)', () => {
    expect(rawClassificationOutputSchema.safeParse('not json').success).toBe(false);
    expect(rawClassificationOutputSchema.safeParse(null).success).toBe(false);
    expect(rawClassificationOutputSchema.safeParse([1, 2, 3]).success).toBe(false);
  });

  it('rejects an over-length summary/language beyond the bounded limits', () => {
    expect(rawClassificationOutputSchema.safeParse({ ...valid, summary: 'a'.repeat(2000) }).success).toBe(false);
    expect(rawClassificationOutputSchema.safeParse({ ...valid, language: 'a'.repeat(100) }).success).toBe(false);
  });
});
