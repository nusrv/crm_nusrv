import { deriveReplyThreadingHeaders, normalizeReplySubject } from './reply-threading.util';

describe('normalizeReplySubject (§12)', () => {
  it('prefixes a plain subject with "Re: "', () => {
    expect(normalizeReplySubject('Renewal notice')).toBe('Re: Renewal notice');
  });

  it('never accumulates "Re: Re: Re:" — strips any existing leading Re: prefixes first', () => {
    expect(normalizeReplySubject('Re: Renewal notice')).toBe('Re: Renewal notice');
    expect(normalizeReplySubject('Re: Re: Renewal notice')).toBe('Re: Renewal notice');
    expect(normalizeReplySubject('RE: re: Re: Renewal notice')).toBe('Re: Renewal notice');
  });

  it('is case-insensitive when stripping an existing prefix', () => {
    expect(normalizeReplySubject('re: Renewal notice')).toBe('Re: Renewal notice');
    expect(normalizeReplySubject('RE:Renewal notice')).toBe('Re: Renewal notice');
  });

  it('produces a bounded, non-empty subject even for an empty/whitespace-only base', () => {
    expect(normalizeReplySubject('')).toBe('Re:');
    expect(normalizeReplySubject('   ')).toBe('Re:');
  });

  it('never exceeds EmailMessage.subject\'s 500-character column width', () => {
    const result = normalizeReplySubject('x'.repeat(600));
    expect(result.length).toBeLessThanOrEqual(500);
  });
});

describe('deriveReplyThreadingHeaders (§11/§10)', () => {
  it('derives In-Reply-To from the latest (first) candidate\'s externalMessageId', () => {
    const headers = deriveReplyThreadingHeaders([{ externalMessageId: '<abc@example.test>', references: null }]);
    expect(headers.inReplyTo).toBe('<abc@example.test>');
  });

  it('accumulates References: the chosen candidate\'s prior references plus its own id', () => {
    const headers = deriveReplyThreadingHeaders([
      { externalMessageId: '<c@example.test>', references: '<a@example.test> <b@example.test>' },
    ]);
    expect(headers.references).toBe('<a@example.test> <b@example.test> <c@example.test>');
  });

  it('never fabricates an identity when there is nothing to reply to', () => {
    expect(deriveReplyThreadingHeaders([])).toEqual({ inReplyTo: null, references: undefined });
    expect(deriveReplyThreadingHeaders([{ externalMessageId: null, references: null }])).toEqual({
      inReplyTo: null,
      references: undefined,
    });
  });

  it('still sets References from just the latest id when there is no prior references chain', () => {
    const headers = deriveReplyThreadingHeaders([{ externalMessageId: '<only@example.test>', references: null }]);
    expect(headers.references).toBe('<only@example.test>');
  });

  it('§10 — the latest (first) candidate has externalMessageId = NULL: falls back to the next-older VALID candidate', () => {
    const headers = deriveReplyThreadingHeaders([
      { externalMessageId: null, references: null },
      { externalMessageId: '<older-valid@example.test>', references: '<even-older@example.test>' },
    ]);
    expect(headers.inReplyTo).toBe('<older-valid@example.test>');
    expect(headers.references).toBe('<even-older@example.test> <older-valid@example.test>');
  });

  it('§10 — the latest candidate has a malformed externalMessageId: falls back to the next-older VALID candidate rather than producing malformed headers', () => {
    const headers = deriveReplyThreadingHeaders([
      // Malformed: no "@", fails the same strict validation Slice C's own ingest path applies.
      { externalMessageId: '<not-a-valid-msgid>', references: null },
      { externalMessageId: '<older-valid@example.test>', references: null },
    ]);
    expect(headers.inReplyTo).toBe('<older-valid@example.test>');
  });

  it('§10 — no candidate in the window has a valid externalMessageId anywhere: In-Reply-To is safely omitted, never fabricated', () => {
    const headers = deriveReplyThreadingHeaders([
      { externalMessageId: null, references: null },
      { externalMessageId: '<not-a-valid-msgid>', references: null },
      { externalMessageId: null, references: null },
    ]);
    expect(headers).toEqual({ inReplyTo: null, references: undefined });
  });
});
