import {
  buildDraftReplyInput,
  MAX_DRAFT_CUSTOMER_NAME_CHARS,
  MAX_DRAFT_TOTAL_CONTEXT_CHARS,
  totalDraftContextChars,
} from './ai-draft-context.util';
import { MAX_HISTORY_MESSAGES, MAX_SUBJECT_CHARS } from './ai-context.util';

function current(bodyText = 'yes please renew') {
  return { subject: 'Renewal notice', bodyText, occurredAt: new Date('2026-01-02T00:00:00.000Z') };
}

describe('buildDraftReplyInput (Slice F §9)', () => {
  it('bounds prior messages to MAX_HISTORY_MESSAGES, oldest-first order preserved', () => {
    const prior = Array.from({ length: 10 }, (_, i) => ({
      subject: `msg ${i}`,
      bodyText: `body ${i}`,
      direction: 'INBOUND' as const,
      occurredAt: new Date(2026, 0, i + 1),
    }));

    const input = buildDraftReplyInput(current(), prior, null, null, null);

    expect(input.priorMessages).toHaveLength(MAX_HISTORY_MESSAGES);
    expect(input.priorMessages[0]!.subject).toBe(`msg ${10 - MAX_HISTORY_MESSAGES}`);
    expect(input.priorMessages[input.priorMessages.length - 1]!.subject).toBe('msg 9');
  });

  it('truncates an over-long subject to MAX_SUBJECT_CHARS', () => {
    const longSubject = 'x'.repeat(MAX_SUBJECT_CHARS + 500);
    const input = buildDraftReplyInput({ ...current(), subject: longSubject }, [], null, null, null);
    expect(input.current.subject.length).toBe(MAX_SUBJECT_CHARS);
  });

  it('truncates an over-long customer name to MAX_DRAFT_CUSTOMER_NAME_CHARS', () => {
    const longName = 'A'.repeat(MAX_DRAFT_CUSTOMER_NAME_CHARS + 100);
    const input = buildDraftReplyInput(current(), [], null, { customerCode: 'C-1', nameEn: longName, nameAr: null, preferredLanguage: 'en' }, null);
    expect(input.customer!.nameEn!.length).toBe(MAX_DRAFT_CUSTOMER_NAME_CHARS);
  });

  it('§8 — absent classification stays null, never fabricated', () => {
    const input = buildDraftReplyInput(current(), [], null, null, null);
    expect(input.effectiveClassification).toBeNull();
  });

  it('carries through effective classification when present', () => {
    const input = buildDraftReplyInput(
      current(),
      [],
      { source: 'HUMAN_REVIEW', intent: 'REQUEST_INVOICE', summary: 'Customer wants an invoice.', language: 'en' },
      null,
      null,
    );
    expect(input.effectiveClassification).toEqual({
      source: 'HUMAN_REVIEW',
      intent: 'REQUEST_INVOICE',
      summary: 'Customer wants an invoice.',
      language: 'en',
    });
  });

  it('carries through renewal context only when present, with a null serviceName preserved', () => {
    const input = buildDraftReplyInput(
      current(),
      [],
      null,
      null,
      { renewalCaseStatus: 'PENDING', dueDate: new Date('2026-02-01T00:00:00.000Z'), subscriptionCode: 'SUB-1', serviceName: null },
    );
    expect(input.renewal).toEqual({
      renewalCaseStatus: 'PENDING',
      dueDate: new Date('2026-02-01T00:00:00.000Z'),
      subscriptionCode: 'SUB-1',
      serviceName: null,
    });
  });

  it('never includes bodyHtml/credentials/unrelated fields — output shape is exactly the documented contract', () => {
    const input = buildDraftReplyInput(current(), [], null, null, null);
    expect(Object.keys(input)).toEqual(['current', 'priorMessages', 'effectiveClassification', 'customer', 'renewal']);
    expect(Object.keys(input.current)).toEqual(['subject', 'bodyText', 'occurredAt']);
  });

  it('§9 invariant — the documented total-context ceiling comfortably covers the worst case built by this function', () => {
    const prior = Array.from({ length: MAX_HISTORY_MESSAGES }, (_, i) => ({
      subject: 'x'.repeat(2000),
      bodyText: 'y'.repeat(2000),
      direction: 'INBOUND' as const,
      occurredAt: new Date(2026, 0, i + 1),
    }));
    const input = buildDraftReplyInput({ ...current(), bodyText: 'z'.repeat(20_000) }, prior, null, null, null);
    expect(totalDraftContextChars(input)).toBeLessThanOrEqual(MAX_DRAFT_TOTAL_CONTEXT_CHARS);
  });
});
