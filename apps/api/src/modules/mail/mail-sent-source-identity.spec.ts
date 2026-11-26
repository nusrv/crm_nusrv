import { computeImapIdentityKey } from './imap-identity.util';
import { sentSourceIdentity } from './mail-sent-source-identity';

const base = { mailConfigurationId: 'mail-1', canonicalFolder: 'Sent', uidValidity: 100n, uid: 20n };
const generation = '11111111-1111-4111-8111-111111111111';

describe('Sent connection generation identity', () => {
  it('preserves legacy identity byte-for-byte', () => {
    expect(sentSourceIdentity(base)).toBe(computeImapIdentityKey(base));
    expect(sentSourceIdentity({ ...base, connectionGeneration: 'legacy' })).toBe(computeImapIdentityKey(base));
  });
  it('isolates later account generations and never reuses a legacy identity', () => {
    const first = sentSourceIdentity({ ...base, connectionGeneration: generation });
    expect(first).toMatch(/^v2:[0-9a-f]{64}$/);
    expect(first).not.toBe(sentSourceIdentity(base));
    expect(first).not.toBe(sentSourceIdentity({ ...base, connectionGeneration: '22222222-2222-4222-8222-222222222222' }));
    expect(first).not.toBe(sentSourceIdentity({ ...base, connectionGeneration: generation, canonicalFolder: 'sent' }));
    expect(first).not.toBe(sentSourceIdentity({ ...base, connectionGeneration: generation, mailConfigurationId: 'mail-2' }));
    expect(first).not.toBe(sentSourceIdentity({ ...base, connectionGeneration: generation, uidValidity: 101n }));
    expect(first).not.toBe(sentSourceIdentity({ ...base, connectionGeneration: generation, uid: 21n }));
    expect(first).toBe(sentSourceIdentity({ ...base, connectionGeneration: generation }));
  });
  it('rejects malformed nonlegacy generations', () => {
    for (const value of ['', 'arbitrary', '11111111-1111-1111-1111-111111111111']) {
      expect(() => sentSourceIdentity({ ...base, connectionGeneration: value })).toThrow();
    }
  });
});
