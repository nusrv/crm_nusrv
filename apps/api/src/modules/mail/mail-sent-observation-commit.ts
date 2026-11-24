import { ConflictException } from '@nestjs/common';
import type { PrismaService } from '../../database/prisma.service';
import type { SentFolderPreview } from './mail-evidence-sent-preview';
import {
  prepareSentObservationWritePlan,
  type SentObservationPlanCheckpoint,
} from './mail-sent-observation-plan';

export type SentObservationCommitResult =
  | { outcome: 'NO_NEW_MESSAGES'; inserted: 0 }
  | { outcome: 'COMMITTED'; inserted: number; lastUid: bigint };

/**
 * P2.C future persistence primitive. This function is intentionally NOT
 * registered in a Nest module, scheduled by a worker, exposed as a controller
 * or invoked by the existing INBOX ingestion path. Its presence in source
 * does not authorize or activate Sent synchronization.
 *
 * The exact source and request were verified during a bounded read-only
 * preview, but this method treats that preview as untrusted and locks/reloads
 * the durable checkpoint before performing any new-ledger writes.
 *
 * All inserts and the new-folder cursor advance live in ONE transaction.
 * On CAS conflict, duplicate evidence, or database error the transaction
 * rolls back, so no cursor can advance past a failed observation save.
 */
export async function commitSentObservationPreview(
  prisma: Pick<PrismaService, '$transaction'>,
  checkpoint: SentObservationPlanCheckpoint,
  preview: SentFolderPreview,
): Promise<SentObservationCommitResult> {
  const plan = prepareSentObservationWritePlan(checkpoint, preview);
  if (!plan) return { outcome: 'NO_NEW_MESSAGES', inserted: 0 };

  return prisma.$transaction(async (tx) => {
    // Lock by the PK before reading the state. A concurrent copy of this
    // worker has to observe the winning cursor after acquiring this lock.
    await tx.$queryRaw`SELECT id FROM mail_evidence_folder_checkpoints WHERE id = ${plan.folderCheckpointId} FOR UPDATE`;
    const actual = await tx.mailEvidenceFolderCheckpoint.findUnique({
      where: { id: plan.folderCheckpointId },
      include: { mailConfiguration: { select: { enabled: true } } },
    });

    if (!actual || actual.uidValidity !== plan.expectedUidValidity ||
        actual.lastUid !== plan.expectedLastUid ||
        actual.folderName !== checkpoint.folderName ||
        actual.folderIdentityKey !== checkpoint.folderIdentityKey ||
        actual.mailConfigurationId !== checkpoint.mailConfigurationId ||
        !actual.mailConfiguration.enabled ||
        actual.sourceKind !== 'SENT' || !actual.syncEnabled || actual.capability !== 'AVAILABLE') {
      throw new ConflictException('Sent evidence checkpoint changed or is no longer authorized.');
    }

    // The stored folder identity and source key must be verified a second
    // time from the locked, authoritative row — caller's checkpoint is NOT
    // proof of a trusted mailbox or cursor.
    const verifiedPlan = prepareSentObservationWritePlan({
      id: actual.id,
      mailConfigurationId: actual.mailConfigurationId,
      folderName: actual.folderName,
      folderIdentityKey: actual.folderIdentityKey,
      sourceKind: actual.sourceKind,
      syncEnabled: actual.syncEnabled,
      capability: actual.capability,
      uidValidity: actual.uidValidity,
      lastUid: actual.lastUid,
    }, preview);
    if (!verifiedPlan || verifiedPlan.rows.length !== plan.rows.length ||
        verifiedPlan.nextLastUid !== plan.nextLastUid) {
      throw new ConflictException('Sent observation source integrity changed.');
    }

    await tx.mailSentObservation.createMany({
      data: verifiedPlan.rows,
    });

    // Compare both epoch + expected previous UID while still holding the
    // row lock. This is for the NEW folder checkpoint, not old INBOX fields.
    const advanced = await tx.mailEvidenceFolderCheckpoint.updateMany({
      where: {
        id: actual.id,
        uidValidity: verifiedPlan.expectedUidValidity,
        lastUid: verifiedPlan.expectedLastUid,
        syncEnabled: true,
        capability: 'AVAILABLE',
        sourceKind: 'SENT',
        folderIdentityKey: actual.folderIdentityKey,
      },
      data: {
        lastUid: verifiedPlan.nextLastUid,
        lastObservedAt: new Date(),
      },
    });
    if (advanced.count !== 1) {
      throw new ConflictException('Concurrent Sent observation cursor update was rejected.');
    }
    return {
      outcome: 'COMMITTED' as const,
      inserted: verifiedPlan.rows.length,
      lastUid: verifiedPlan.nextLastUid,
    };
  });
}
