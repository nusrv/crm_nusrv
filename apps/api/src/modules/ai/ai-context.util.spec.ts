import {
  MAX_CURRENT_BODY_CHARS,
  MAX_HISTORY_BODY_CHARS_EACH,
  MAX_HISTORY_MESSAGES,
  MAX_SUBJECT_CHARS,
  MAX_TOTAL_CONTEXT_CHARS,
  buildClassificationInput,
  totalContextChars,
} from './ai-context.util';

const current = { subject: 'Renewal', bodyText: 'yes please renew', occurredAt: new Date('2026-01-05T00:00:00Z') };

describe('buildClassificationInput', () => {
  it('bounds the current message body to MAX_CURRENT_BODY_CHARS', () => {
    const huge = { ...current, bodyText: 'a'.repeat(MAX_CURRENT_BODY_CHARS + 5_000) };
    const input = buildClassificationInput(huge, []);
    expect(input.current.bodyText.length).toBe(MAX_CURRENT_BODY_CHARS);
  });

  it('bounds the subject to MAX_SUBJECT_CHARS', () => {
    const huge = { ...current, subject: 'x'.repeat(MAX_SUBJECT_CHARS + 100) };
    const input = buildClassificationInput(huge, []);
    expect(input.current.subject.length).toBe(MAX_SUBJECT_CHARS);
  });

  it('keeps at most MAX_HISTORY_MESSAGES prior messages, taking the most recent ones', () => {
    const history = Array.from({ length: 10 }, (_, i) => ({
      subject: `s${i}`,
      bodyText: `body ${i}`,
      direction: 'INBOUND' as const,
      occurredAt: new Date(2026, 0, i + 1),
    }));
    const input = buildClassificationInput(current, history);
    expect(input.priorMessages).toHaveLength(MAX_HISTORY_MESSAGES);
    // The LAST MAX_HISTORY_MESSAGES entries of the (already chronological) input are kept.
    expect(input.priorMessages.map((m) => m.subject)).toEqual(['s6', 's7', 's8', 's9']);
  });

  it('preserves chronological order of prior messages (never re-sorts)', () => {
    const history = [
      { subject: 'first', bodyText: 'a', direction: 'INBOUND' as const, occurredAt: new Date('2026-01-01') },
      { subject: 'second', bodyText: 'b', direction: 'OUTBOUND' as const, occurredAt: new Date('2026-01-02') },
    ];
    const input = buildClassificationInput(current, history);
    expect(input.priorMessages.map((m) => m.subject)).toEqual(['first', 'second']);
  });

  it('bounds each prior message body to MAX_HISTORY_BODY_CHARS_EACH', () => {
    const history = [
      { subject: 's', bodyText: 'a'.repeat(MAX_HISTORY_BODY_CHARS_EACH + 500), direction: 'INBOUND' as const, occurredAt: new Date() },
    ];
    const input = buildClassificationInput(current, history);
    expect(input.priorMessages[0]!.bodyText.length).toBe(MAX_HISTORY_BODY_CHARS_EACH);
  });

  it('never includes bodyHtml, attachments, or any field beyond subject/bodyText/direction/occurredAt for history', () => {
    const history = [{ subject: 's', bodyText: 'b', direction: 'INBOUND' as const, occurredAt: new Date() }];
    const input = buildClassificationInput(current, history);
    expect(Object.keys(input.priorMessages[0]!).sort()).toEqual(['bodyText', 'direction', 'occurredAt', 'subject']);
  });

  it('the maximum possible total context never exceeds MAX_TOTAL_CONTEXT_CHARS', () => {
    const huge = { ...current, bodyText: 'a'.repeat(MAX_CURRENT_BODY_CHARS + 1000), subject: 'x'.repeat(MAX_SUBJECT_CHARS + 100) };
    const history = Array.from({ length: 10 }, (_, i) => ({
      subject: 'x'.repeat(MAX_SUBJECT_CHARS + 100),
      bodyText: 'a'.repeat(MAX_HISTORY_BODY_CHARS_EACH + 1000),
      direction: 'INBOUND' as const,
      occurredAt: new Date(2026, 0, i + 1),
    }));
    const input = buildClassificationInput(huge, history);
    expect(totalContextChars(input)).toBeLessThanOrEqual(MAX_TOTAL_CONTEXT_CHARS);
  });

  it('handles zero prior messages', () => {
    const input = buildClassificationInput(current, []);
    expect(input.priorMessages).toEqual([]);
  });
});
