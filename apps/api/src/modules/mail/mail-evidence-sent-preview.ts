import { computeImapIdentityKey, canonicalizeImapFolder } from './imap-identity.util';
import { classifyFolderCursor, mailEvidenceFolderIdentityKey } from './mail-evidence-folder-identity';
import { MAX_IMAP_UID, MAX_SENT_OBSERVATIONS, type FetchedMailboxMessage, type SentMailboxReader } from './mailbox-reader';

/**
 * P2.C source-only, read-only Sent observation preview.
 *
 * This module is NOT registered as a worker, route or scheduler. It never
 * persists a message, advances a cursor, sends email, or infers SMTP
 * acceptance/delivery. In particular a message's To header is not treated
 * as a trusted SMTP envelope recipient or an authenticated DSN.
 */
export interface SentFolderPreviewCheckpoint {
  mailConfigurationId: string;
  folderName: string;
  folderIdentityKey: string;
  sourceKind: string;
  syncEnabled: boolean;
  capability: string;
  uidValidity: bigint | null;
  lastUid: bigint | null;
}

export interface SentFolderObservation {
  sourceIdentityKey: string;
  uid: bigint;
  internalDate: Date | null;
  messageIdHeader: string | null;
  parseFailed: boolean;
  /** This is explicitly never a delivery assertion. */
  deliveryStatus: 'UNKNOWN';
}

export type SentFolderPreview =
  | { outcome: 'NOT_ENABLED' | 'NOT_AVAILABLE' | 'NOT_SENT_SOURCE' | 'FOLDER_IDENTITY_MISMATCH' |
    'INVALID_CURSOR' | 'NEEDS_BASELINE' | 'INVALID_LIMIT' | 'BOUNDED_SEARCH_UNAVAILABLE' |
    'FETCH_INTEGRITY_ERROR'; observations: [] }
  | { outcome: 'UIDVALIDITY_CHANGED'; currentUidValidity: bigint; observations: [] }
  | { outcome: 'PREVIEW_ONLY'; observations: SentFolderObservation[]; highestObservedUid: bigint | null };

export const SENT_PREVIEW_MAX_MESSAGES = MAX_SENT_OBSERVATIONS;

/**
 * Explicitly authorized caller-supplied preview only. The disabled-by-default
 * checkpoint table is intentionally not queried here; a future, separately
 * approved service must verify current flags AND authoritative mailbox identity
 * before passing the checkpoint and reader to this function.
 */
export async function previewSentFolderObservations(
  checkpoint: SentFolderPreviewCheckpoint,
  reader: SentMailboxReader,
  requestedLimit = SENT_PREVIEW_MAX_MESSAGES,
): Promise<SentFolderPreview> {
  const empty = (outcome:
    | 'NOT_ENABLED' | 'NOT_AVAILABLE' | 'NOT_SENT_SOURCE' | 'FOLDER_IDENTITY_MISMATCH'
    | 'INVALID_CURSOR' | 'NEEDS_BASELINE' | 'INVALID_LIMIT' | 'BOUNDED_SEARCH_UNAVAILABLE' | 'FETCH_INTEGRITY_ERROR',
  ): SentFolderPreview => ({ outcome, observations: [] });

  if (!checkpoint.syncEnabled) return empty('NOT_ENABLED');
  if (checkpoint.sourceKind !== 'SENT') return empty('NOT_SENT_SOURCE');
  if (checkpoint.capability !== 'AVAILABLE') return empty('NOT_AVAILABLE');
  if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1) return empty('INVALID_LIMIT');

  let verifiedIdentity: string;
  try {
    verifiedIdentity = mailEvidenceFolderIdentityKey(checkpoint.folderName);
  } catch {
    return empty('FOLDER_IDENTITY_MISMATCH');
  }
  if (!checkpoint.mailConfigurationId.trim() ||
      checkpoint.folderIdentityKey !== verifiedIdentity ||
      canonicalizeImapFolder(checkpoint.folderName) === 'INBOX') {
    return empty('FOLDER_IDENTITY_MISMATCH');
  }

  const cursorState = classifyFolderCursor(checkpoint);
  if (cursorState === 'INCONSISTENT') return empty('INVALID_CURSOR');
  if (cursorState === 'UNINITIALIZED') return empty('NEEDS_BASELINE');
  // UIDVALIDITY cannot be zero and stored last UID must not be negative.
  if (checkpoint.uidValidity! <= 0n || checkpoint.uidValidity! > MAX_IMAP_UID ||
      checkpoint.lastUid! < 0n || checkpoint.lastUid! > MAX_IMAP_UID) return empty('INVALID_CURSOR');

  const limit = Math.min(requestedLimit, SENT_PREVIEW_MAX_MESSAGES);
  const result = await reader.fetchSentMessagesSince(
    checkpoint.folderName, checkpoint.uidValidity!, checkpoint.lastUid!, limit,
  );
  if (result.outcome === 'uidvalidity_changed') {
    return { outcome: 'UIDVALIDITY_CHANGED', currentUidValidity: result.currentUidValidity, observations: [] };
  }
  if (result.outcome !== 'ok') {
    return empty(result.outcome === 'bounded_search_unavailable' ? 'BOUNDED_SEARCH_UNAVAILABLE' : 'FETCH_INTEGRITY_ERROR');
  }

  const canonicalFolder = canonicalizeImapFolder(checkpoint.folderName);
  // A malformed reader result must not become a persisted cursor candidate.
  // In particular, never silently hide duplicate UIDs, descending scans or
  // a batch larger than the requested bound.
  if (result.messages.length > limit) return empty('FETCH_INTEGRITY_ERROR');
  let previousUid = checkpoint.lastUid!;
  for (const message of result.messages) {
    if (typeof message.uid !== 'bigint' || message.uid <= previousUid || message.uid > MAX_IMAP_UID) {
      return empty('FETCH_INTEGRITY_ERROR');
    }
    previousUid = message.uid;
  }
  const messages: FetchedMailboxMessage[] = result.messages;

  // No cursor update, no sender/recipient matching, no provider/DSN assertion.
  const observations: SentFolderObservation[] = messages.map((message) => ({
    sourceIdentityKey: computeImapIdentityKey({
      mailConfigurationId: checkpoint.mailConfigurationId,
      canonicalFolder,
      uidValidity: checkpoint.uidValidity!,
      uid: message.uid,
    }),
    uid: message.uid,
    internalDate: message.internalDate ?? null,
    messageIdHeader: message.messageIdHeader ?? null,
    parseFailed: message.parseFailed,
    deliveryStatus: 'UNKNOWN',
  }));

  return {
    outcome: 'PREVIEW_ONLY',
    observations,
    highestObservedUid: messages.length ? messages[messages.length - 1]!.uid : null,
  };
}
