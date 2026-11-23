import {
  classifyFolderCursor,
  decideFolderCursorAdvance,
  mailEvidenceFolderIdentityKey,
} from './mail-evidence-folder-identity';

describe('P2.B independent IMAP folder identity, without changing existing INBOX cursor', () => {
  it('canonicalizes only INBOX spelling, not any arbitrary Sent-like folder', () => {
    expect(mailEvidenceFolderIdentityKey('INBOX')).toBe(mailEvidenceFolderIdentityKey('inbox'));
    expect(mailEvidenceFolderIdentityKey('INBOX')).toBe(mailEvidenceFolderIdentityKey('InBoX'));
    expect(mailEvidenceFolderIdentityKey('Sent')).not.toBe(mailEvidenceFolderIdentityKey('sent'));
    expect(mailEvidenceFolderIdentityKey('Sent')).not.toBe(mailEvidenceFolderIdentityKey(' Sent'));
    expect(mailEvidenceFolderIdentityKey('Sent Items')).not.toBe(mailEvidenceFolderIdentityKey('Sent'));
  });

  it('produces a versioned, stable, 67-character storage identity', () => {
    const key = mailEvidenceFolderIdentityKey('Sent Items/2026');
    expect(key).toMatch(/^v1:[0-9a-f]{64}$/);
    expect(key).toBe(mailEvidenceFolderIdentityKey('Sent Items/2026'));
    expect(mailEvidenceFolderIdentityKey('Archive/2026')).not.toBe(key);
  });

  it('rejects blank, null-byte, oversize and unpaired surrogate names before persisting', () => {
    for (const folder of ['', '  ', '\0Sent', 'x'.repeat(256), '\uD800', '\uDC00']) {
      expect(() => mailEvidenceFolderIdentityKey(folder)).toThrow();
    }
    expect(() => mailEvidenceFolderIdentityKey('📨 Archive')).not.toThrow();
  });

  it('requires manual review for partly initialized checkpoints', () => {
    expect(classifyFolderCursor({ uidValidity: null, lastUid: 1n })).toBe('INCONSISTENT');
    expect(classifyFolderCursor({ uidValidity: 7n, lastUid: null })).toBe('INCONSISTENT');
    expect(decideFolderCursorAdvance({ uidValidity: null, lastUid: 1n }, 7n, 2n))
      .toBe('INCONSISTENT_REQUIRES_REVIEW');
  });

  it('does not silently bootstrap an unseen Sent folder or alter old INBOX checkpoints', () => {
    const newCursor = { uidValidity: null, lastUid: null };
    expect(classifyFolderCursor(newCursor)).toBe('UNINITIALIZED');
    expect(decideFolderCursorAdvance(newCursor, 1n, 500n))
      .toBe('BASELINE_REQUIRES_EXPLICIT_POLICY');
    expect(newCursor).toEqual({ uidValidity: null, lastUid: null });
  });

  it('requires review after UIDVALIDITY reset instead of reimporting historic mailbox data', () => {
    const cursor = { uidValidity: 100n, lastUid: 42n };
    expect(decideFolderCursorAdvance(cursor, 101n, 43n))
      .toBe('UIDVALIDITY_CHANGED_REQUIRES_REVIEW');
    expect(cursor).toEqual({ uidValidity: 100n, lastUid: 42n });
  });

  it('only allows monotonic same-epoch cursor advancement, subject to future DB CAS', () => {
    const cursor = { uidValidity: 100n, lastUid: 42n };
    expect(decideFolderCursorAdvance(cursor, 100n, 42n)).toBe('ALREADY_OBSERVED');
    expect(decideFolderCursorAdvance(cursor, 100n, 41n)).toBe('ALREADY_OBSERVED');
    expect(decideFolderCursorAdvance(cursor, 100n, 43n)).toBe('ADVANCE_WITH_CAS');
  });
});
