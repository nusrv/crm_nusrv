import { jest } from '@jest/globals';
import { computeImapIdentityKey } from './imap-identity.util';
import {
  previewSentFolderObservations, SENT_PREVIEW_MAX_MESSAGES,
  type SentFolderPreviewCheckpoint,
} from './mail-evidence-sent-preview';
import { mailEvidenceFolderIdentityKey } from './mail-evidence-folder-identity';
import type { FetchSinceResult, FetchedMailboxMessage, MailboxReader } from './mailbox-reader';

const base: SentFolderPreviewCheckpoint = {
  mailConfigurationId: 'mail-A',
  folderName: 'Sent Items',
  folderIdentityKey: mailEvidenceFolderIdentityKey('Sent Items'),
  sourceKind: 'SENT',
  syncEnabled: true, // Explicit unit-test opt-in; persisted schema default is false.
  capability: 'AVAILABLE',
  uidValidity: 123n,
  lastUid: 10n,
};

const checkpoint = (changes: Partial<SentFolderPreviewCheckpoint> = {}): SentFolderPreviewCheckpoint =>
  ({ ...base, ...changes });

function message(uid: bigint, changes: Partial<FetchedMailboxMessage> = {}): FetchedMailboxMessage {
  return {
    uid,
    internalDate: new Date('2026-11-23T08:00:00.000Z'),
    subject: 'Not evidence of delivery',
    fromAddress: 'staff@example.test',
    toAddresses: ['person@example.test'],
    messageIdHeader: '<message@case.example>',
    inReplyToHeader: undefined,
    referencesHeader: undefined,
    renewalCaseIdHeader: undefined,
    text: 'Customer sensitive content is never in the preview',
    html: '<p>Not an authoritative SMTP receipt</p>',
    parseFailed: false,
    ...changes,
  };
}

function fakeReader(result: FetchSinceResult = { outcome: 'ok', messages: [] }) {
  const fetch = jest.fn<MailboxReader['fetchMessagesSince']>(
    () => Promise.resolve(result),
  );
  return { reader: { fetchMessagesSince: fetch }, fetch };
}

describe('P2.C read-only bounded Sent observations — no worker or cursor side effects', () => {
  it('does not contact a reader when checkpoint polling is disabled', async () => {
    const { reader, fetch } = fakeReader();
    await expect(previewSentFolderObservations(checkpoint({ syncEnabled: false }), reader))
      .resolves.toEqual({ outcome: 'NOT_ENABLED', observations: [] });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('requires a real, explicitly enabled Sent source with a matching folder identity', async () => {
    for (const changes of [
      { sourceKind: 'INBOX' },
      { capability: 'UNPROBED' },
      { capability: 'UNAVAILABLE' },
      { folderIdentityKey: mailEvidenceFolderIdentityKey('sent items') },
      { folderName: 'INBOX', folderIdentityKey: mailEvidenceFolderIdentityKey('INBOX') },
      { folderName: '' },
      { mailConfigurationId: '' },
    ]) {
      const { reader, fetch } = fakeReader();
      const result = await previewSentFolderObservations(checkpoint(changes), reader);
      expect(result.outcome).not.toBe('PREVIEW_ONLY');
      expect(fetch).not.toHaveBeenCalled();
    }
  });

  it('does not bootstrap or silently repair an unknown, partial, or invalid UID cursor', async () => {
    for (const changes of [
      { uidValidity: null, lastUid: null },
      { uidValidity: 10n, lastUid: null },
      { uidValidity: null, lastUid: 10n },
      { uidValidity: 0n },
      { lastUid: -1n },
    ]) {
      const { reader, fetch } = fakeReader();
      const result = await previewSentFolderObservations(checkpoint(changes), reader);
      expect(['NEEDS_BASELINE', 'INVALID_CURSOR']).toContain(result.outcome);
      expect(fetch).not.toHaveBeenCalled();
    }
  });

  it('reads a bounded batch, keeps message identity case-sensitive, never exposes body, and changes no cursor', async () => {
    const state = checkpoint();
    const { reader, fetch } = fakeReader({
      outcome: 'ok',
      messages: [message(11n), message(15n, { messageIdHeader: '<case@Example.test>' })],
    });
    const result = await previewSentFolderObservations(state, reader, 2);
    expect(fetch).toHaveBeenCalledWith('Sent Items', 123n, 10n, 2);
    expect(result.outcome).toBe('PREVIEW_ONLY');
    if (result.outcome !== 'PREVIEW_ONLY') throw new Error('Expected a read-only preview');
    expect(result.highestObservedUid).toBe(15n);
    expect(result.observations).toEqual([
      expect.objectContaining({
        uid: 11n, deliveryStatus: 'UNKNOWN',
        sourceIdentityKey: computeImapIdentityKey({
          mailConfigurationId: 'mail-A', canonicalFolder: 'Sent Items', uidValidity: 123n, uid: 11n,
        }),
      }),
      expect.objectContaining({ uid: 15n, messageIdHeader: '<case@Example.test>', deliveryStatus: 'UNKNOWN' }),
    ]);
    expect(JSON.stringify(result, (key: string, value: unknown) => {
      void key;
      return typeof value === 'bigint' ? value.toString() : value;
    })).not.toContain('Customer sensitive content');
    expect(state.lastUid).toBe(10n);
    expect(state.uidValidity).toBe(123n);
  });

  it('fails closed on an IMAP UIDVALIDITY epoch change, never auto-resetting a cursor', async () => {
    const { reader } = fakeReader({ outcome: 'uidvalidity_changed', currentUidValidity: 124n });
    await expect(previewSentFolderObservations(checkpoint(), reader))
      .resolves.toEqual({
        outcome: 'UIDVALIDITY_CHANGED', currentUidValidity: 124n, observations: [],
      });
  });

  it('rejects duplicated, descending, old and over-limit batches, instead of guessing the next cursor', async () => {
    const malformed: FetchedMailboxMessage[][] = [
      [message(11n), message(11n)],
      [message(12n), message(11n)],
      [message(10n)],
      Array.from({ length: 3 }, (_, index) => message(BigInt(index + 11))),
    ];
    for (const messages of malformed) {
      const { reader } = fakeReader({ outcome: 'ok', messages });
      await expect(previewSentFolderObservations(checkpoint(), reader, 2))
        .resolves.toEqual({ outcome: 'FETCH_INTEGRITY_ERROR', observations: [] });
    }
  });

  it('enforces the global batch cap and refuses invalid requested limits without fetching', async () => {
    const invalid = fakeReader();
    await expect(previewSentFolderObservations(checkpoint(), invalid.reader, 0))
      .resolves.toMatchObject({ outcome: 'INVALID_LIMIT' });
    await expect(previewSentFolderObservations(checkpoint(), invalid.reader, Number.NaN))
      .resolves.toMatchObject({ outcome: 'INVALID_LIMIT' });
    expect(invalid.fetch).not.toHaveBeenCalled();

    const { reader, fetch } = fakeReader();
    const result = await previewSentFolderObservations(checkpoint(), reader, 10000);
    expect(fetch).toHaveBeenCalledWith('Sent Items', 123n, 10n, SENT_PREVIEW_MAX_MESSAGES);
    expect(result).toEqual({ outcome: 'PREVIEW_ONLY', observations: [], highestObservedUid: null });
  });
});
