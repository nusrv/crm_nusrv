import { generateStableMessageId } from './mail-message-id.util';

describe('generateStableMessageId', () => {
  it('produces an RFC 5322-shaped angle-bracketed id using the sender domain', () => {
    const id = generateStableMessageId('renewals@example.test');
    expect(id).toMatch(/^<[0-9a-f-]{36}@example\.test>$/);
  });

  it('falls back to localhost when the from-address has no domain', () => {
    const id = generateStableMessageId('malformed-address');
    expect(id.endsWith('@localhost>')).toBe(true);
  });

  it('never repeats across calls', () => {
    const first = generateStableMessageId('a@example.test');
    const second = generateStableMessageId('a@example.test');
    expect(first).not.toBe(second);
  });
});
