import { jest } from '@jest/globals';
import { ConflictException } from '@nestjs/common';
import type { PrismaService } from '../../database/prisma.service';
import { computeImapIdentityKey } from './imap-identity.util';
import { mailEvidenceFolderIdentityKey } from './mail-evidence-folder-identity';
import { commitSentObservationPreview } from './mail-sent-observation-commit';
import type { SentObservationPlanCheckpoint } from './mail-sent-observation-plan';
import type { SentFolderPreview } from './mail-evidence-sent-preview';

function checkpoint(): SentObservationPlanCheckpoint {
  return {
    id: 'sent-checkpoint-1',
    mailConfigurationId: 'mail-1',
    folderName: 'Sent Items',
    folderIdentityKey: mailEvidenceFolderIdentityKey('Sent Items'),
    sourceKind: 'SENT',
    syncEnabled: true,
    capability: 'AVAILABLE',
    uidValidity: 100n,
    lastUid: 200n,
  };
}

function preview(): SentFolderPreview {
  return {
    outcome: 'PREVIEW_ONLY',
    observations: [{
      sourceIdentityKey: computeImapIdentityKey({
        mailConfigurationId: 'mail-1',
        canonicalFolder: 'Sent Items',
        uidValidity: 100n,
        uid: 201n,
      }),
      uid: 201n,
      internalDate: new Date('2026-11-23T15:00:00.000Z'),
      messageIdHeader: '<source@Test.example>',
      parseFailed: false,
      deliveryStatus: 'UNKNOWN',
    }],
    highestObservedUid: 201n,
  };
}

function harness(options: {
  stale?: boolean;
  disabled?: boolean;
  casCount?: number;
  insertFails?: boolean;
} = {}) {
  const sequence: string[] = [];
  const initial = checkpoint();
  const locked = {
    ...initial,
    lastUid: options.stale ? 201n : 200n,
    syncEnabled: options.disabled ? false : true,
  };
  const tx = {
    $queryRaw: jest.fn(() => {
      sequence.push('lock');
      return Promise.resolve([{ id: 'sent-checkpoint-1' }]);
    }),
    mailEvidenceFolderCheckpoint: {
      findUnique: jest.fn(() => {
        sequence.push('find');
        return Promise.resolve(locked);
      }),
      updateMany: jest.fn(() => {
        sequence.push('cas');
        return Promise.resolve({ count: options.casCount ?? 1 });
      }),
    },
    mailSentObservation: {
      createMany: jest.fn((input: { data: unknown[] }) => {
        sequence.push('insert');
        if (options.insertFails) return Promise.reject(new Error('Unique source identity collision'));
        return Promise.resolve({ count: input.data.length });
      }),
    },
  };
  const transaction = jest.fn(<T>(callback: (client: typeof tx) => Promise<T>): Promise<T> =>
    callback(tx));
  const prisma = { $transaction: transaction } as unknown as Pick<PrismaService, '$transaction'>;
  return { prisma, tx, transaction, sequence };
}

describe('P2.C offline atomic Sent evidence commit, no registered worker', () => {
  it('locks source, inserts UNKNOWN evidence then conditionally advances only the new cursor', async () => {
    const h = harness();
    const result = await commitSentObservationPreview(h.prisma, checkpoint(), preview());
    expect(result).toEqual({ outcome: 'COMMITTED', inserted: 1, lastUid: 201n });
    expect(h.sequence).toEqual(['lock', 'find', 'insert', 'cas']);
    expect(h.tx.mailSentObservation.createMany).toHaveBeenCalledWith({
      data: [{
        folderCheckpointId: 'sent-checkpoint-1',
        sourceIdentityKey: expect.any(String),
        uidValidity: 100n,
        uid: 201n,
        internalDate: new Date('2026-11-23T15:00:00.000Z'),
        messageIdHeader: '<source@Test.example>',
        parseFailed: false,
        deliveryStatus: 'UNKNOWN',
      }],
    });
    expect(h.tx.mailEvidenceFolderCheckpoint.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'sent-checkpoint-1', uidValidity: 100n, lastUid: 200n,
        syncEnabled: true, capability: 'AVAILABLE', sourceKind: 'SENT',
      }),
      data: { lastUid: 201n, lastObservedAt: expect.any(Date) },
    });
  });

  it('refuses stale or disabled source after locking without inserting or advancing', async () => {
    for (const options of [{ stale: true }, { disabled: true }]) {
      const h = harness(options);
      await expect(commitSentObservationPreview(h.prisma, checkpoint(), preview()))
        .rejects.toBeInstanceOf(ConflictException);
      expect(h.sequence).toEqual(['lock', 'find']);
    }
  });

  it('raises on a losing cursor compare-and-set so a real Prisma transaction rolls back inserts', async () => {
    const h = harness({ casCount: 0 });
    await expect(commitSentObservationPreview(h.prisma, checkpoint(), preview()))
      .rejects.toBeInstanceOf(ConflictException);
    expect(h.sequence).toEqual(['lock', 'find', 'insert', 'cas']);
    // Mock fixtures cannot prove SQL rollback; disposable MariaDB must do that.
  });

  it('does not advance when a duplicate evidence insert fails', async () => {
    const h = harness({ insertFails: true });
    await expect(commitSentObservationPreview(h.prisma, checkpoint(), preview()))
      .rejects.toThrow('Unique source identity collision');
    expect(h.sequence).toEqual(['lock', 'find', 'insert']);
  });

  it('does not open a transaction for an empty preview', async () => {
    const h = harness();
    const result = await commitSentObservationPreview(h.prisma, checkpoint(), {
      outcome: 'PREVIEW_ONLY', observations: [], highestObservedUid: null,
    });
    expect(result).toEqual({ outcome: 'NO_NEW_MESSAGES', inserted: 0 });
    expect(h.transaction).not.toHaveBeenCalled();
  });
});
