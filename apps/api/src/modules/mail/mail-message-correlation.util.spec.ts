import {
  MAX_MESSAGE_ID_LENGTH,
  buildReferencesStorageValue,
  parseMessageIdTokens,
  parsePrimaryMessageId,
} from './mail-message-correlation.util';

describe('parseMessageIdTokens', () => {
  it('returns an empty array for missing/null/undefined/empty headers', () => {
    expect(parseMessageIdTokens(undefined)).toEqual([]);
    expect(parseMessageIdTokens(null)).toEqual([]);
    expect(parseMessageIdTokens('')).toEqual([]);
    expect(parseMessageIdTokens('   ')).toEqual([]);
  });

  it('normalizes a single bracketed Message-ID', () => {
    expect(parseMessageIdTokens('<abc123@example.com>')).toEqual(['<abc123@example.com>']);
  });

  it('parses multiple References into individual tokens, preserving order', () => {
    const references = '<a@example.com> <b@example.com>\r\n <c@example.com>';
    expect(parseMessageIdTokens(references)).toEqual([
      '<a@example.com>',
      '<b@example.com>',
      '<c@example.com>',
    ]);
  });

  it('collapses header-folding whitespace/newlines without corrupting tokens', () => {
    const folded = '<a@example.com>\r\n\t<b@example.com>';
    expect(parseMessageIdTokens(folded)).toEqual(['<a@example.com>', '<b@example.com>']);
  });

  it('accepts a plausible bare msg-id with no angle brackets at all', () => {
    expect(parseMessageIdTokens('abc123@example.com')).toEqual(['<abc123@example.com>']);
  });

  it('never lowercases identifier content — msg-id content is case-sensitive', () => {
    expect(parseMessageIdTokens('<AbC123@Example.COM>')).toEqual(['<AbC123@Example.COM>']);
  });

  it('trims incidental whitespace inside a bracketed token', () => {
    expect(parseMessageIdTokens('< abc123@example.com >')).toEqual(['<abc123@example.com>']);
  });

  it('ignores an empty bracket pair', () => {
    expect(parseMessageIdTokens('<>')).toEqual([]);
  });

  // --- Hardened identity rules: never fabricate a strong identity from junk (§5) ---

  it('rejects arbitrary malformed text with no "@" — never fabricates an identity', () => {
    expect(parseMessageIdTokens('not-an-id')).toEqual([]);
    expect(parseMessageIdTokens('<not-an-id>')).toEqual([]);
  });

  it('rejects a bare candidate containing whitespace', () => {
    expect(parseMessageIdTokens('hello world')).toEqual([]);
  });

  it('rejects a bracketed token containing internal whitespace', () => {
    expect(parseMessageIdTokens('<hello world@example.com>')).toEqual([]);
  });

  it('rejects a token containing control characters', () => {
    const bell = String.fromCharCode(7);
    const nul = String.fromCharCode(0);
    expect(parseMessageIdTokens(`<abc${bell}@example.com>`)).toEqual([]);
    expect(parseMessageIdTokens(`<abc@example${nul}.com>`)).toEqual([]);
  });

  it('rejects a token with more than one "@"', () => {
    expect(parseMessageIdTokens('<abc@def@example.com>')).toEqual([]);
  });

  it('rejects a token with an empty local part or empty domain part', () => {
    expect(parseMessageIdTokens('<@example.com>')).toEqual([]);
    expect(parseMessageIdTokens('<abc@>')).toEqual([]);
  });

  it('drops only the invalid tokens in a References header, keeping the valid ones', () => {
    const references = 'garbage <a@example.com> not-an-id <also garbage> <b@example.com>';
    expect(parseMessageIdTokens(references)).toEqual(['<a@example.com>', '<b@example.com>']);
  });

  it('rejects (never truncates) a token that exceeds the VarChar(500) identity column width', () => {
    const overLong = `${'a'.repeat(MAX_MESSAGE_ID_LENGTH)}@example.com`; // well past 500 chars total
    expect(parseMessageIdTokens(`<${overLong}>`)).toEqual([]);
  });

  it('never lets two distinct over-length ids collide on a truncated prefix', () => {
    const sharedPrefix = 'x'.repeat(600);
    const idA = `<${sharedPrefix}AAA@example.com>`;
    const idB = `<${sharedPrefix}BBB@example.com>`;
    // Neither produces any token at all — there is no truncated form for either to collide on.
    expect(parseMessageIdTokens(idA)).toEqual([]);
    expect(parseMessageIdTokens(idB)).toEqual([]);
  });

  it('accepts an identifier that fits exactly at the column width', () => {
    const inner = `${'a'.repeat(490)}@${'b'.repeat(5)}`; // 490 + 1 + 5 = 496
    const token = `<${inner}>`; // 496 + 2 = 498 <= 500
    expect(token.length).toBeLessThanOrEqual(MAX_MESSAGE_ID_LENGTH);
    expect(parseMessageIdTokens(token)).toEqual([token]);
  });

  it('bounds CPU/memory work on a pathologically large References header instead of hanging', () => {
    const huge = Array.from({ length: 5000 }, (_, i) => `<msg${i}@example.com>`).join(' ');
    const start = Date.now();
    const result = parseMessageIdTokens(huge);
    expect(Date.now() - start).toBeLessThan(1000);
    expect(result.length).toBeLessThanOrEqual(200);
  });
});

describe('parsePrimaryMessageId', () => {
  it('returns the first token for a normal In-Reply-To header', () => {
    expect(parsePrimaryMessageId('<abc123@example.com>')).toBe('<abc123@example.com>');
  });

  it('returns null when nothing is present', () => {
    expect(parsePrimaryMessageId(undefined)).toBeNull();
  });

  it('returns null for malformed In-Reply-To content rather than fabricating an id', () => {
    expect(parsePrimaryMessageId('not-an-id')).toBeNull();
  });

  it('matches the exact format generateStableMessageId produces (angle-bracket wrapped)', () => {
    const outboundStyle = '<3fa2c1e4-9b7d-4a2e-8c1f-6e2d9a0b1c2d@nusrv.com>';
    expect(parsePrimaryMessageId(outboundStyle)).toBe(outboundStyle);
  });
});

describe('buildReferencesStorageValue', () => {
  it('returns undefined for an empty token list', () => {
    expect(buildReferencesStorageValue([], 1000)).toBeUndefined();
  });

  it('joins complete tokens with a single space', () => {
    expect(buildReferencesStorageValue(['<a@x.com>', '<b@x.com>'], 1000)).toBe('<a@x.com> <b@x.com>');
  });

  it('stops before a complete token would exceed the byte budget, never truncating mid-token', () => {
    const tokens = ['<aaaaaaaaaa@x.com>', '<bbbbbbbbbb@x.com>', '<cccccccccc@x.com>'];
    const firstTwoBytes = Buffer.byteLength('<aaaaaaaaaa@x.com> <bbbbbbbbbb@x.com>', 'utf8');
    const result = buildReferencesStorageValue(tokens, firstTwoBytes);
    expect(result).toBe('<aaaaaaaaaa@x.com> <bbbbbbbbbb@x.com>');
    expect(result).not.toContain('ccccccc'); // no partial third token.
  });

  it('returns undefined when even the first token exceeds the budget, never returning a partial token', () => {
    expect(buildReferencesStorageValue(['<abcdefghij@example.com>'], 5)).toBeUndefined();
  });

  it('never exceeds the given byte budget', () => {
    const tokens = Array.from({ length: 500 }, (_, i) => `<msg${i}@example.com>`);
    const result = buildReferencesStorageValue(tokens, 1000);
    expect(Buffer.byteLength(result ?? '', 'utf8')).toBeLessThanOrEqual(1000);
  });
});
