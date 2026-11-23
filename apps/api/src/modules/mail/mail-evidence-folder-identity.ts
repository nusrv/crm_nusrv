import { createHash } from 'node:crypto';
import { canonicalizeImapFolder } from './imap-identity.util';

/**
 * P2.B identity for independent, disabled-by-default folder checkpoints.
 *
 * Only INBOX is case-insensitive. No trim, whitespace collapse or Unicode
 * normalization is performed on valid folder names: 'Sent' and 'sent' are
 * different IMAP folders, as are 'Sent' and ' Sent'.
 *
 * The digest is versioned because it is persisted under a unique DB index.
 * Do not alter this v1 encoding after deployment.
 */
export function mailEvidenceFolderIdentityKey(folderName: string): string {
  if (!folderName || !folderName.trim() || Array.from(folderName).length > 255 ||
      folderName.includes('\0')) {
    throw new Error('IMAP folder identity must be a non-empty, bounded folder name.');
  }

  // Reject unpaired UTF-16 surrogates. Otherwise two distinct JS strings can
  // silently encode to the same U+FFFD replacement bytes in UTF-8.
  for (let index = 0; index < folderName.length; index += 1) {
    const unit = folderName.charCodeAt(index);
    if (unit >= 0xD800 && unit <= 0xDBFF) {
      const next = folderName.charCodeAt(index + 1);
      if (!(next >= 0xDC00 && next <= 0xDFFF)) {
        throw new Error('IMAP folder identity has invalid Unicode.');
      }
      index += 1;
    } else if (unit >= 0xDC00 && unit <= 0xDFFF) {
      throw new Error('IMAP folder identity has invalid Unicode.');
    }
  }

  const canonical = canonicalizeImapFolder(folderName);
  const bytes = Buffer.byteLength(canonical, 'utf8');
  const digest = createHash('sha256')
    .update(`${bytes}:${canonical}`, 'utf8')
    .digest('hex');
  return `v1:${digest}`;
}

/** Pure guard only — not a worker and not a persistence or reset command. */
export type FolderCursorState = 'UNINITIALIZED' | 'ESTABLISHED' | 'INCONSISTENT';
export type FolderCursor = {
  uidValidity: bigint | null;
  lastUid: bigint | null;
};

export function classifyFolderCursor(cursor: FolderCursor): FolderCursorState {
  if (cursor.uidValidity === null && cursor.lastUid === null) return 'UNINITIALIZED';
  if (cursor.uidValidity !== null && cursor.lastUid !== null) return 'ESTABLISHED';
  return 'INCONSISTENT';
}

/**
 * A future folder sync worker must CAS against both stored cursor fields.
 * This precheck never establishes or repairs cursors and forbids UID epoch
 * changes from silently resetting/replaying old mailbox contents.
 */
export type FolderCursorAdvanceDecision =
  | 'BASELINE_REQUIRES_EXPLICIT_POLICY'
  | 'INCONSISTENT_REQUIRES_REVIEW'
  | 'UIDVALIDITY_CHANGED_REQUIRES_REVIEW'
  | 'ALREADY_OBSERVED'
  | 'ADVANCE_WITH_CAS';

export function decideFolderCursorAdvance(
  cursor: FolderCursor,
  observedUidValidity: bigint,
  observedUid: bigint,
): FolderCursorAdvanceDecision {
  const status = classifyFolderCursor(cursor);
  if (status === 'INCONSISTENT') return 'INCONSISTENT_REQUIRES_REVIEW';
  if (status === 'UNINITIALIZED') return 'BASELINE_REQUIRES_EXPLICIT_POLICY';
  if (observedUidValidity !== cursor.uidValidity) return 'UIDVALIDITY_CHANGED_REQUIRES_REVIEW';
  if (observedUid <= cursor.lastUid!) return 'ALREADY_OBSERVED';
  return 'ADVANCE_WITH_CAS';
}
