import { computeImapIdentityKey } from './imap-identity.util';
import { mailEvidenceFolderIdentityKey } from './mail-evidence-folder-identity';
import { prepareSentObservationWritePlan } from './mail-sent-observation-plan';
import type { SentFolderPreview, SentFolderPreviewCheckpoint } from './mail-evidence-sent-preview';

const current = (): SentFolderPreviewCheckpoint & { id: string } => ({
  id: 'checkpoint-1',
  mailConfigurationId: 'config-1',
  folderName: 'Sent Items',
  folderIdentityKey: mailEvidenceFolderIdentityKey('Sent Items'),
  sourceKind: 'SENT',
  syncEnabled: true,
  capability: 'AVAILABLE',
  uidValidity: 15n,
  lastUid: 100n,
});

function sourceIdentity(uid: bigint): string {
  return computeImapIdentityKey({
    mailConfigurationId: 'config-1',
    canonicalFolder: 'Sent Items',
    uidValidity: 15n,
    uid,
  });
}

const preview = (): SentFolderPreview => ({
  outcome: 'PREVIEW_ONLY',
  observations: [
    {
      sourceIdentityKey: sourceIdentity(101n),
      uid: 101n,
      internalDate: new Date('2026-11-23T11:20:00.000Z'),
      messageIdHeader: '<One@Example.test>',
      parseFailed: false,
      deliveryStatus: 'UNKNOWN',
    },
    {
      sourceIdentityKey: sourceIdentity(105n),
      uid: 105n,
      internalDate: null,
      messageIdHeader: null,
      parseFailed: true,
      deliveryStatus: 'UNKNOWN',
    },
  ],
  highestObservedUid: 105n,
});

describe('P2.C safe observation write plan, not a worker', () => {
  it('regenerates every exact source identity and produces only UNKNOWN delivery evidence', () => {
    const plan = prepareSentObservationWritePlan(current(), preview());
    expect(plan).toMatchObject({
      folderCheckpointId: 'checkpoint-1',
      expectedUidValidity: 15n,
      expectedLastUid: 100n,
      nextLastUid: 105n,
    });
    expect(plan?.rows).toEqual([
      {
        folderCheckpointId: 'checkpoint-1',
        sourceIdentityKey: sourceIdentity(101n),
        uidValidity: 15n,
        uid: 101n,
        internalDate: new Date('2026-11-23T11:20:00.000Z'),
        messageIdHeader: '<One@Example.test>',
        parseFailed: false,
        deliveryStatus: 'UNKNOWN',
      },
      {
        folderCheckpointId: 'checkpoint-1',
        sourceIdentityKey: sourceIdentity(105n),
        uidValidity: 15n,
        uid: 105n,
        internalDate: null,
        messageIdHeader: null,
        parseFailed: true,
        deliveryStatus: 'UNKNOWN',
      },
    ]);
    expect(Object.keys(plan?.rows[0] ?? {})).not.toContain('bodyText');
    expect(Object.keys(plan?.rows[0] ?? {})).not.toContain('envelopeRecipient');
  });

  it('refuses any disabled, unprobed, non-Sent, INBOX, or wrong-folder checkpoint', () => {
    const cases = [
      { syncEnabled: false },
      { capability: 'UNPROBED' },
      { capability: 'UNAVAILABLE' },
      { sourceKind: 'INBOX' },
      { folderIdentityKey: mailEvidenceFolderIdentityKey('sent items') },
      { folderName: 'INBOX', folderIdentityKey: mailEvidenceFolderIdentityKey('INBOX') },
      { id: '' },
    ];
    for (const changed of cases) {
      expect(() => prepareSentObservationWritePlan({ ...current(), ...changed }, preview())).toThrow();
    }
  });

  it('does not infer a baseline or repair an inconsistent cursor', () => {
    for (const changed of [
      { uidValidity: null, lastUid: null },
      { uidValidity: 15n, lastUid: null },
      { uidValidity: null, lastUid: 100n },
      { uidValidity: 0n },
      { lastUid: -1n },
    ]) {
      expect(() => prepareSentObservationWritePlan({ ...current(), ...changed }, preview())).toThrow();
    }
  });

  it('rejects fake/duplicate/out-of-order UID or tampered identity and delivery state', () => {
    const valid = preview();
    if (valid.outcome !== 'PREVIEW_ONLY') throw new Error('Invalid test fixture');
    const [first, second] = valid.observations;
    const modified = [
      { ...valid, observations: [first, { ...second, uid: 101n }] },
      { ...valid, observations: [second, first] },
      { ...valid, observations: [{ ...first, uid: 100n }, second] },
      { ...valid, observations: [{ ...first, sourceIdentityKey: 'v1:forged' }, second] },
      { ...valid, observations: [{ ...first, deliveryStatus: 'DELIVERED' as never }, second] },
      { ...valid, highestObservedUid: 500n },
      { ...valid, observations: [{ ...first, messageIdHeader: 'x'.repeat(501) }, second] },
      { ...valid, observations: [{ ...first, internalDate: new Date(NaN) }, second] },
    ];
    for (const input of modified) {
      expect(() => prepareSentObservationWritePlan(current(), input)).toThrow();
    }
  });

  it('returns no transaction work for an empty preview and rejects inconsistent empty bounds', () => {
    expect(prepareSentObservationWritePlan(current(), {
      outcome: 'PREVIEW_ONLY', observations: [], highestObservedUid: null,
    })).toBeNull();
    expect(() => prepareSentObservationWritePlan(current(), {
      outcome: 'PREVIEW_ONLY', observations: [], highestObservedUid: 10n,
    })).toThrow();
  });

  it('refuses a UIDVALIDITY change and any non-successful preview', () => {
    expect(() => prepareSentObservationWritePlan(current(), {
      outcome: 'UIDVALIDITY_CHANGED', currentUidValidity: 16n, observations: [],
    })).toThrow();
    expect(() => prepareSentObservationWritePlan(current(), {
      outcome: 'NOT_ENABLED', observations: [],
    })).toThrow();
  });
});
