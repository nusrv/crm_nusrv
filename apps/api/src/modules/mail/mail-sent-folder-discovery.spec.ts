import { mailEvidenceFolderIdentityKey } from './mail-evidence-folder-identity';
import { discoverProviderSentFolder, planFutureOnlySentBaseline } from './mail-sent-folder-discovery';

const mailbox = 'mailbox-1';
const folderName = 'Shared/Messages envoyés';
const listed = (path: string, ...flags: string[]) => ({ path, listed: true, flags: new Set(flags) });
const checkpoint = {
  id: 'checkpoint-1', mailConfigurationId: mailbox, folderName,
  folderIdentityKey: mailEvidenceFolderIdentityKey(folderName), sourceKind: 'SENT',
  syncEnabled: false, uidValidity: null, lastUid: null,
};

describe('provider Sent discovery', () => {
  it('preserves the server path and ignores synthesized localized names', () => {
    const nameGuess = { ...listed('Sent'), specialUse: '\\Sent', specialUseSource: 'name' };
    expect(discoverProviderSentFolder(mailbox, [nameGuess, listed(folderName, '\\sEnT')])).toEqual({
      outcome: 'AVAILABLE',
      folder: { mailConfigurationId: mailbox, folderName, folderIdentityKey: checkpoint.folderIdentityKey },
    });
    expect(discoverProviderSentFolder(mailbox, [nameGuess])).toEqual({ outcome: 'NO_SERVER_SENT_FOLDER' });
  });

  it('excludes missing, unsubstitutable and non-selectable folders', () => {
    expect(discoverProviderSentFolder(mailbox, [
      { ...listed('Not listed', '\\Sent'), listed: false },
      listed('Disabled', '\\Sent', '\\Noselect'),
      listed('Missing', '\\Sent', '\\NonExistent'),
    ])).toEqual({ outcome: 'NO_SERVER_SENT_FOLDER' });
  });

  it('refuses multiple distinct server Sent flags, including paths that differ only in case', () => {
    expect(discoverProviderSentFolder(mailbox, [listed('Sent', '\\Sent'), listed('sent', '\\Sent')]))
      .toEqual({ outcome: 'AMBIGUOUS_SENT_FOLDERS' });
  });

  it.each([
    [listed('INBOX', '\\Sent')],
    [listed('Sent', '\\Sent'), listed('Sent')],
    [listed('Sent\r\nspoof', '\\Sent')],
    [listed('', '\\Sent')],
  ])('refuses malformed or colliding list rows (%j)', (...rows) => {
    expect(discoverProviderSentFolder(mailbox, rows)).toEqual({ outcome: 'INVALID_LIST' });
  });
});

describe('future-only baseline proposal', () => {
  const discovery = discoverProviderSentFolder(mailbox, [listed(folderName, '\\Sent')]);
  const liveState = {
    mailConfigurationId: mailbox, folderName, folderIdentityKey: checkpoint.folderIdentityKey,
    uidValidity: 27n, uidNext: 201n,
  };
  it('plans to skip older folder mail without enabling synchronization', () => {
    expect(planFutureOnlySentBaseline(checkpoint, discovery, folderName, liveState)).toEqual({
      outcome: 'BASELINE_PROPOSED', checkpointId: checkpoint.id, uidValidity: 27n, lastUid: 200n,
    });
    expect(planFutureOnlySentBaseline(checkpoint, discovery, folderName, { ...liveState, uidNext: 1n }))
      .toMatchObject({ lastUid: 0n });
    expect(checkpoint).toMatchObject({ syncEnabled: false, uidValidity: null, lastUid: null });
  });

  it('refuses to reset an established, partly initialized or active checkpoint', () => {
    for (const current of [
      { ...checkpoint, uidValidity: 2n, lastUid: 3n },
      { ...checkpoint, uidValidity: 2n },
      { ...checkpoint, syncEnabled: true },
    ]) {
      expect(planFutureOnlySentBaseline(current, discovery, folderName, liveState))
        .toEqual({ outcome: 'CHECKPOINT_NOT_UNINITIALIZED' });
    }
  });

  it('requires exact explicit folder identity and mailbox ownership', () => {
    expect(planFutureOnlySentBaseline(checkpoint, discovery, folderName.toLowerCase(), liveState))
      .toEqual({ outcome: 'SOURCE_NOT_CONFIRMED' });
    expect(planFutureOnlySentBaseline({ ...checkpoint, mailConfigurationId: 'other' }, discovery, folderName, liveState))
      .toEqual({ outcome: 'SOURCE_NOT_CONFIRMED' });
    expect(planFutureOnlySentBaseline(checkpoint, discovery, folderName, { ...liveState, folderName: 'other' }))
      .toEqual({ outcome: 'SOURCE_NOT_CONFIRMED' });
  });

  it('rejects invalid server UID state', () => {
    for (const state of [{ uidValidity: 0n, uidNext: 1n }, { uidValidity: 1n, uidNext: 4_294_967_296n }]) {
      expect(planFutureOnlySentBaseline(checkpoint, discovery, folderName, { ...liveState, ...state }))
        .toEqual({ outcome: 'INVALID_IMAP_STATE' });
    }
  });
});
