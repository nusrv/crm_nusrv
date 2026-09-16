import {
  canonicalImapIdentityEncoding,
  canonicalizeImapFolder,
  computeImapIdentityKey,
} from './imap-identity.util';

describe('canonicalizeImapFolder', () => {
  it('canonicalizes any case-insensitive match of INBOX to the literal string INBOX', () => {
    expect(canonicalizeImapFolder('INBOX')).toBe('INBOX');
    expect(canonicalizeImapFolder('inbox')).toBe('INBOX');
    expect(canonicalizeImapFolder('Inbox')).toBe('INBOX');
    expect(canonicalizeImapFolder('InBoX')).toBe('INBOX');
  });

  it('preserves every other folder name exactly, including case and whitespace', () => {
    expect(canonicalizeImapFolder('Sales')).toBe('Sales');
    expect(canonicalizeImapFolder('sales')).toBe('sales');
    expect(canonicalizeImapFolder(' Sales ')).toBe(' Sales ');
    expect(canonicalizeImapFolder('INBOX.Sub')).toBe('INBOX.Sub');
  });

  it('never confuses "Sales" and "sales" — two distinct canonicalFolder values', () => {
    expect(canonicalizeImapFolder('Sales')).not.toBe(canonicalizeImapFolder('sales'));
  });
});

describe('canonicalImapIdentityEncoding', () => {
  it('matches the exact worked example documented on EmailMessage.imapIdentityKey', () => {
    const encoding = canonicalImapIdentityEncoding({
      mailConfigurationId: 'abc',
      canonicalFolder: 'INBOX',
      uidValidity: 7n,
      uid: 42n,
    });
    expect(encoding).toBe('3:abc5:INBOX1:72:42');
  });

  it('is length-prefixed so two tuples that would collide under naive concatenation stay distinct', () => {
    // Naive delimiter-free concatenation of ["ab", "c"] and ["a", "bc"] both yield "abc...";
    // the length prefix makes them provably distinct ("2:ab1:c..." vs "1:a2:bc...").
    const tupleA = canonicalImapIdentityEncoding({
      mailConfigurationId: 'ab',
      canonicalFolder: 'c',
      uidValidity: 1n,
      uid: 1n,
    });
    const tupleB = canonicalImapIdentityEncoding({
      mailConfigurationId: 'a',
      canonicalFolder: 'bc',
      uidValidity: 1n,
      uid: 1n,
    });
    expect(tupleA).not.toBe(tupleB);
    expect(tupleA).toBe('2:ab1:c1:11:1');
    expect(tupleB).toBe('1:a2:bc1:11:1');
  });

  it('uses UTF-8 byte length, not JS string character length, for multi-byte folder names', () => {
    // "é" is 1 JS UTF-16 code unit but 2 UTF-8 bytes.
    const encoding = canonicalImapIdentityEncoding({
      mailConfigurationId: 'x',
      canonicalFolder: 'é',
      uidValidity: 1n,
      uid: 1n,
    });
    expect(encoding).toBe('1:x2:é1:11:1');
  });
});

describe('computeImapIdentityKey', () => {
  it('matches the exact documented worked example hash', () => {
    const key = computeImapIdentityKey({
      mailConfigurationId: 'abc',
      canonicalFolder: 'INBOX',
      uidValidity: 7n,
      uid: 42n,
    });
    expect(key).toBe('v1:905a02252a2b7a544a55ac926bd9b2300f3d563bf779f22f0dcce19b34a7ce81');
  });

  it('is always exactly 67 characters: "v1:" plus 64 lowercase hex characters', () => {
    const key = computeImapIdentityKey({
      mailConfigurationId: 'some-config-id',
      canonicalFolder: 'Sales',
      uidValidity: 123456789n,
      uid: 987654321n,
    });
    expect(key).toHaveLength(67);
    expect(key).toMatch(/^v1:[0-9a-f]{64}$/);
  });

  it('produces different keys for different UIDs under the same folder/config/uidValidity', () => {
    const base = { mailConfigurationId: 'cfg', canonicalFolder: 'INBOX', uidValidity: 1n };
    const a = computeImapIdentityKey({ ...base, uid: 1n });
    const b = computeImapIdentityKey({ ...base, uid: 2n });
    expect(a).not.toBe(b);
  });

  it('produces different keys when only uidValidity differs (mailbox recreated)', () => {
    const base = { mailConfigurationId: 'cfg', canonicalFolder: 'INBOX', uid: 1n };
    const a = computeImapIdentityKey({ ...base, uidValidity: 1n });
    const b = computeImapIdentityKey({ ...base, uidValidity: 2n });
    expect(a).not.toBe(b);
  });

  it('produces different keys when only the mailConfigurationId differs (different mailbox)', () => {
    const base = { canonicalFolder: 'INBOX', uidValidity: 1n, uid: 1n };
    const a = computeImapIdentityKey({ ...base, mailConfigurationId: 'cfg-a' });
    const b = computeImapIdentityKey({ ...base, mailConfigurationId: 'cfg-b' });
    expect(a).not.toBe(b);
  });

  it('produces different keys for "Sales" vs "sales" folders (case-sensitive except INBOX)', () => {
    const base = { mailConfigurationId: 'cfg', uidValidity: 1n, uid: 1n };
    const a = computeImapIdentityKey({ ...base, canonicalFolder: 'Sales' });
    const b = computeImapIdentityKey({ ...base, canonicalFolder: 'sales' });
    expect(a).not.toBe(b);
  });
});
