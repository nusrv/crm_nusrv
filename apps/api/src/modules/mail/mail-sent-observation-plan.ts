import { computeImapIdentityKey } from './imap-identity.util';
import { classifyFolderCursor, mailEvidenceFolderIdentityKey } from './mail-evidence-folder-identity';
import {
  SENT_PREVIEW_MAX_MESSAGES,
  type SentFolderPreview,
  type SentFolderPreviewCheckpoint,
} from './mail-evidence-sent-preview';

/**
 * P2.C — prepares durable Sent observation rows for an eventual, separately
 * authorized and CAS-guarded transaction. This file performs NO I/O, DB writes,
 * mailbox reads, forwarding, or delivery-state transitions.
 *
 * The caller MUST reload and lock the real checkpoint, compare uidValidity and
 * lastUid with the expected values and insert these rows in ONE transaction
 * before conditionally advancing only the NEW folder checkpoint. This is not
 * yet a registered Nest service or an active worker.
 */
export type SentObservationPlanCheckpoint = SentFolderPreviewCheckpoint & { id: string };

export interface PlannedSentObservation {
  folderCheckpointId: string;
  sourceIdentityKey: string;
  uidValidity: bigint;
  uid: bigint;
  internalDate: Date | null;
  messageIdHeader: string | null;
  parseFailed: boolean;
  deliveryStatus: 'UNKNOWN';
}

export interface SentObservationWritePlan {
  folderCheckpointId: string;
  expectedUidValidity: bigint;
  expectedLastUid: bigint;
  nextLastUid: bigint;
  rows: PlannedSentObservation[];
}

function fail(message: string): never {
  throw new Error(`Sent observation plan rejected: ${message}`);
}

/**
 * A preview is UNTRUSTED input even if the reader was ours. Every stable
 * identity is regenerated from the checkpoint, folder and UID, not accepted
 * from the preview payload. No SMTP recipient or attempted delivery is inferred.
 */
export function prepareSentObservationWritePlan(
  checkpoint: SentObservationPlanCheckpoint,
  preview: SentFolderPreview,
): SentObservationWritePlan | null {
  if (!checkpoint.id?.trim() || !checkpoint.mailConfigurationId?.trim()) {
    return fail('missing durable checkpoint ownership');
  }
  if (!checkpoint.syncEnabled || checkpoint.sourceKind !== 'SENT' ||
      checkpoint.capability !== 'AVAILABLE') {
    return fail('folder observation is not explicitly authorized');
  }

  let identity: string;
  try {
    identity = mailEvidenceFolderIdentityKey(checkpoint.folderName);
  } catch {
    return fail('invalid folder name');
  }
  if (checkpoint.folderIdentityKey !== identity || checkpoint.folderName.toUpperCase() === 'INBOX') {
    return fail('folder identity does not match its checkpoint');
  }
  if (classifyFolderCursor(checkpoint) !== 'ESTABLISHED' ||
      checkpoint.uidValidity === null || checkpoint.uidValidity <= 0n ||
      checkpoint.lastUid === null || checkpoint.lastUid < 0n) {
    return fail('missing or invalid established cursor');
  }
  if (preview.outcome !== 'PREVIEW_ONLY') return fail('not a successful observation preview');

  const observations = preview.observations;
  if (observations.length > SENT_PREVIEW_MAX_MESSAGES) return fail('batch exceeds maximum size');
  if (observations.length === 0) {
    if (preview.highestObservedUid !== null) return fail('empty preview has unexpected highest UID');
    return null;
  }

  const rows: PlannedSentObservation[] = [];
  let precedingUid = checkpoint.lastUid;
  for (const item of observations) {
    if (item.uid <= precedingUid || item.uid <= 0n) return fail('UIDs not strictly increasing');
    if (item.deliveryStatus !== 'UNKNOWN') return fail('observations cannot assert delivery');
    if (item.messageIdHeader !== null && Array.from(item.messageIdHeader).length > 500) {
      return fail('message ID header exceeds storage bounds');
    }
    if (item.internalDate !== null &&
        (!(item.internalDate instanceof Date) || !Number.isFinite(item.internalDate.getTime()))) {
      return fail('invalid IMAP internal date');
    }
    const expectedSourceIdentity = computeImapIdentityKey({
      mailConfigurationId: checkpoint.mailConfigurationId,
      canonicalFolder: checkpoint.folderName,
      uidValidity: checkpoint.uidValidity,
      uid: item.uid,
    });
    if (item.sourceIdentityKey !== expectedSourceIdentity) {
      return fail('untrusted or conflicting source identity key');
    }
    rows.push({
      folderCheckpointId: checkpoint.id,
      sourceIdentityKey: expectedSourceIdentity,
      uidValidity: checkpoint.uidValidity,
      uid: item.uid,
      internalDate: item.internalDate,
      messageIdHeader: item.messageIdHeader,
      parseFailed: item.parseFailed,
      deliveryStatus: 'UNKNOWN',
    });
    precedingUid = item.uid;
  }
  if (preview.highestObservedUid !== precedingUid) {
    return fail('highest UID does not match verified batch');
  }
  return {
    folderCheckpointId: checkpoint.id,
    expectedUidValidity: checkpoint.uidValidity,
    expectedLastUid: checkpoint.lastUid,
    nextLastUid: precedingUid,
    rows,
  };
}
