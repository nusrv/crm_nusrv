import { MockMailboxReader } from './mock-mailbox-reader';
import type { FetchedMailboxMessage } from './mailbox-reader';

function message(uid: bigint, overrides: Partial<FetchedMailboxMessage> = {}): FetchedMailboxMessage {
  return {
    uid,
    internalDate: new Date('2026-01-01T00:00:00.000Z'),
    subject: `subject-${uid}`,
    fromAddress: 'someone@example.com',
    toAddresses: ['support@nusrv.com'],
    messageIdHeader: `<${uid}@example.com>`,
    inReplyToHeader: undefined,
    referencesHeader: undefined,
    renewalCaseIdHeader: undefined,
    text: `body-${uid}`,
    html: undefined,
    parseFailed: false,
    ...overrides,
  };
}

describe('MockMailboxReader', () => {
  it('returns a default empty state (1/1) for an unconfigured folder, never touching the network', () => {
    const reader = new MockMailboxReader();
    return reader.getMailboxState('INBOX').then((state) => {
      expect(state).toEqual({ uidValidity: 1n, uidNext: 1n });
    });
  });

  it('fetches only messages with uid > afterUid, ascending, bounded by limit', async () => {
    const reader = new MockMailboxReader();
    reader.setFolderState('INBOX', 1n, 10n, [message(3n), message(1n), message(5n), message(2n)]);

    const result = await reader.fetchMessagesSince('INBOX', 1n, 1n, 2);
    expect(result.outcome).toBe('ok');
    if (result.outcome === 'ok') {
      expect(result.messages.map((m) => m.uid)).toEqual([2n, 3n]);
    }
  });

  it('appendMessage advances uidNext like a real server would', async () => {
    const reader = new MockMailboxReader();
    reader.setFolderState('INBOX', 1n, 5n, []);
    reader.appendMessage('INBOX', message(10n));

    const state = await reader.getMailboxState('INBOX');
    expect(state.uidNext).toBe(11n);
  });

  it('changeUidValidity resets the folder, simulating mailbox recreation', async () => {
    const reader = new MockMailboxReader();
    reader.setFolderState('INBOX', 1n, 5n, [message(1n), message(2n)]);
    reader.changeUidValidity('INBOX', 2n, 1n);

    const state = await reader.getMailboxState('INBOX');
    expect(state).toEqual({ uidValidity: 2n, uidNext: 1n });
  });

  it('close() is idempotent and marks the reader closed', async () => {
    const reader = new MockMailboxReader();
    await reader.close();
    await reader.close();
    expect(reader.closed).toBe(true);
  });

  it('fetchMessagesSince returns {outcome:"ok", messages:[]} for a folder with no configured state (default identity 1n)', async () => {
    const reader = new MockMailboxReader();
    expect(await reader.fetchMessagesSince('Nonexistent', 1n, 0n, 10)).toEqual({ outcome: 'ok', messages: [] });
  });

  // --- Protocol correctness pass: finite UID range + UIDVALIDITY-at-fetch-time (§1, §2) ---

  it('A — no UID greater than afterUid exists: returns [] without returning the mailbox\'s highest historical message', async () => {
    const reader = new MockMailboxReader();
    // uidNext=101 -> highest existing UID is 100 -> afterUid=100 means nothing is new.
    reader.setFolderState('INBOX', 1n, 101n, [message(100n)]);

    const result = await reader.fetchMessagesSince('INBOX', 1n, 100n, 10);

    expect(result).toEqual({ outcome: 'ok', messages: [] });
  });

  it('B — fetches only the finite range (afterUid, uidNext-1], never reaching past the current upper bound', async () => {
    const reader = new MockMailboxReader();
    reader.setFolderState('INBOX', 1n, 104n, [message(101n), message(102n), message(103n)]);

    const result = await reader.fetchMessagesSince('INBOX', 1n, 100n, 10);

    expect(result.outcome).toBe('ok');
    if (result.outcome === 'ok') {
      expect(result.messages.map((m) => m.uid)).toEqual([101n, 102n, 103n]);
    }
  });

  it('C — a cursor ahead of the current highest existing message (post-expunge) never re-returns an older message', async () => {
    const reader = new MockMailboxReader();
    // Only UID 50 physically remains (higher UIDs were expunged), but UIDNEXT still reflects the
    // highest UID ever assigned (RFC 3501 — UIDNEXT never decreases).
    reader.setFolderState('INBOX', 1n, 201n, [message(50n)]);

    const result = await reader.fetchMessagesSince('INBOX', 1n, 200n, 10);

    expect(result).toEqual({ outcome: 'ok', messages: [] }); // never re-returns UID 50.
  });

  it('D — the batch limit is still respected within a finite range', async () => {
    const reader = new MockMailboxReader();
    const messages = [1n, 2n, 3n, 4n, 5n].map((uid) => message(uid));
    reader.setFolderState('INBOX', 1n, 6n, messages);

    const result = await reader.fetchMessagesSince('INBOX', 1n, 0n, 2);

    expect(result.outcome).toBe('ok');
    if (result.outcome === 'ok') {
      expect(result.messages).toHaveLength(2);
      expect(result.messages.map((m) => m.uid)).toEqual([1n, 2n]);
    }
  });

  it('reports uidvalidity_changed (fetching nothing) when the expected UIDVALIDITY no longer matches', async () => {
    const reader = new MockMailboxReader();
    reader.setFolderState('INBOX', 5n, 10n, [message(6n)]);

    const result = await reader.fetchMessagesSince('INBOX', 1n /* stale expected */, 0n, 10);

    expect(result).toEqual({ outcome: 'uidvalidity_changed', currentUidValidity: 5n });
  });
});
