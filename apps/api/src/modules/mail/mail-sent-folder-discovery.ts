import { canonicalizeImapFolder } from './imap-identity.util';
import { mailEvidenceFolderIdentityKey, type FolderCursor } from './mail-evidence-folder-identity';
import { hasAsciiControl } from './mail-evidence-text';
import { MAX_IMAP_UID, type MailboxSyncState } from './mailbox-reader';

const MAX_LIST_ENTRIES = 2048;

interface ListedFolder {
  path: string;
  listed: boolean;
  flags: ReadonlySet<string>;
}

interface SentFolderIdentity {
  mailConfigurationId: string;
  folderName: string;
  folderIdentityKey: string;
}

export type SentBaselineSource = SentFolderIdentity & MailboxSyncState;

export type SentFolderDiscovery =
  | { outcome: 'AVAILABLE'; folder: SentFolderIdentity }
  | { outcome: 'NOT_ENABLED' | 'NO_SERVER_SENT_FOLDER' | 'AMBIGUOUS_SENT_FOLDERS' | 'INVALID_LIST' };

/** Use server LIST/XLIST flags only. The provider library also returns name guesses. */
export function discoverProviderSentFolder(
  mailConfigurationId: string,
  rows: readonly ListedFolder[],
): SentFolderDiscovery {
  if (typeof mailConfigurationId !== 'string' || !mailConfigurationId.trim() || hasAsciiControl(mailConfigurationId) ||
      !Array.isArray(rows) || rows.length > MAX_LIST_ENTRIES) return { outcome: 'INVALID_LIST' };

  const paths = new Set<string>();
  const candidates: SentFolderIdentity[] = [];
  for (const row of rows as readonly ListedFolder[]) {
    if (!row || typeof row.path !== 'string' || typeof row.listed !== 'boolean' ||
        !(row.flags instanceof Set) || row.flags.size > 64 || hasAsciiControl(row.path)) return { outcome: 'INVALID_LIST' };
    const path = canonicalizeImapFolder(row.path);
    if (paths.has(path)) return { outcome: 'INVALID_LIST' };
    paths.add(path);
    const flags = new Set<string>();
    for (const flag of row.flags) {
      if (typeof flag !== 'string') return { outcome: 'INVALID_LIST' };
      flags.add(flag.toLowerCase());
    }
    if (!row.listed || !flags.has('\\sent') || flags.has('\\noselect') || flags.has('\\nonexistent')) continue;
    if (path === 'INBOX') return { outcome: 'INVALID_LIST' };
    try {
      candidates.push({ mailConfigurationId, folderName: path, folderIdentityKey: mailEvidenceFolderIdentityKey(path) });
    } catch {
      return { outcome: 'INVALID_LIST' };
    }
  }
  if (candidates.length === 0) return { outcome: 'NO_SERVER_SENT_FOLDER' };
  if (candidates.length > 1) return { outcome: 'AMBIGUOUS_SENT_FOLDERS' };
  return { outcome: 'AVAILABLE', folder: candidates[0]! };
}

type InactiveSentCheckpoint = SentFolderIdentity & FolderCursor & { id: string; sourceKind: string; syncEnabled: boolean };

export type SentBaselinePlan =
  | { outcome: 'BASELINE_PROPOSED'; checkpointId: string; uidValidity: bigint; lastUid: bigint }
  | { outcome: 'CHECKPOINT_NOT_UNINITIALIZED' | 'SOURCE_NOT_CONFIRMED' | 'INVALID_IMAP_STATE' };

/** Plan a future-only baseline. A null-to-value CAS and explicit activation are separate operations. */
export function planFutureOnlySentBaseline(
  checkpoint: InactiveSentCheckpoint,
  discovery: SentFolderDiscovery,
  selectedFolder: string,
  state: SentBaselineSource,
): SentBaselinePlan {
  if (checkpoint.syncEnabled || checkpoint.uidValidity !== null || checkpoint.lastUid !== null) {
    return { outcome: 'CHECKPOINT_NOT_UNINITIALIZED' };
  }
  if (checkpoint.sourceKind !== 'SENT' || !checkpoint.id.trim() || !checkpoint.mailConfigurationId.trim() ||
      hasAsciiControl(checkpoint.mailConfigurationId) || discovery.outcome !== 'AVAILABLE' ||
      selectedFolder !== discovery.folder.folderName || checkpoint.folderName !== selectedFolder ||
      checkpoint.folderIdentityKey !== discovery.folder.folderIdentityKey ||
      checkpoint.mailConfigurationId !== discovery.folder.mailConfigurationId ||
      state.mailConfigurationId !== checkpoint.mailConfigurationId || state.folderName !== selectedFolder ||
      state.folderIdentityKey !== checkpoint.folderIdentityKey) {
    return { outcome: 'SOURCE_NOT_CONFIRMED' };
  }
  try {
    if (canonicalizeImapFolder(selectedFolder) === 'INBOX' || hasAsciiControl(selectedFolder) ||
        mailEvidenceFolderIdentityKey(selectedFolder) !== checkpoint.folderIdentityKey) {
      return { outcome: 'SOURCE_NOT_CONFIRMED' };
    }
  } catch {
    return { outcome: 'SOURCE_NOT_CONFIRMED' };
  }
  if (typeof state.uidValidity !== 'bigint' || typeof state.uidNext !== 'bigint' ||
      state.uidValidity < 1n || state.uidValidity > MAX_IMAP_UID ||
      state.uidNext < 1n || state.uidNext > MAX_IMAP_UID) {
    return { outcome: 'INVALID_IMAP_STATE' };
  }
  return { outcome: 'BASELINE_PROPOSED', checkpointId: checkpoint.id, uidValidity: state.uidValidity, lastUid: state.uidNext - 1n };
}
