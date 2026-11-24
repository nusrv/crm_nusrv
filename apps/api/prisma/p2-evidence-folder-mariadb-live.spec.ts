import { randomUUID } from 'node:crypto';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../src/generated/prisma/client';
import { PaymentScope } from '../src/generated/prisma/enums';
import { toMariaDbDriverUrl } from '../src/database/mariadb-url';
import { mailEvidenceFolderIdentityKey } from '../src/modules/mail/mail-evidence-folder-identity';
import { computeImapIdentityKey } from '../src/modules/mail/imap-identity.util';
import { commitSentObservationPreview } from '../src/modules/mail/mail-sent-observation-commit';

// Destructive disposable CI fixture only. Never point at a live/owner database.
const testUrl = process.env.MARIADB_TEST_DATABASE_URL;
const run = testUrl ? describe : describe.skip;

function disposableDatabase(input: string): string {
  const url = new URL(input);
  if (url.protocol !== 'mysql:' || url.hostname !== '127.0.0.1' ||
      url.port !== '3306' || url.pathname !== '/nusrv_rehearsal_test') {
    throw new Error('This test is permitted only on disposable localhost nusrv_rehearsal_test.');
  }
  return input;
}

run('P2.B disabled folder checkpoint migration (isolated MariaDB)', () => {
  let prisma: PrismaClient;
  let issuerId: string;
  let configurationId: string;

  beforeAll(async () => {
    prisma = new PrismaClient({
      adapter: new PrismaMariaDb(toMariaDbDriverUrl(disposableDatabase(testUrl!))),
    });
    // Scope keys are generated from a real issuer; never invent an invalid
    // configuration scope even inside integration fixtures.
    const issuer = await prisma.billingEntity.create({
      data: {
        code: `P2CI-${randomUUID()}`,
        customerCodePrefix: `P${randomUUID().slice(0, 6).toUpperCase()}`,
        name: 'P2 Disposable Issuer',
        legalName: 'P2 Disposable Issuer LLC',
        paymentScope: PaymentScope.LOCAL,
      },
    });
    issuerId = issuer.id;
    const row = await prisma.mailConfiguration.create({
      data: {
        billingEntityId: issuerId,
        scopeKey: `BILLING_ENTITY:${issuerId}`,
        label: 'P2 disposal-only mailbox',
        environment: 'SANDBOX',
        enabled: false,
        smtpHost: 'not-connected.example.test',
        smtpPort: 587,
        smtpUsername: 'p2@example.test',
        imapHost: 'not-connected.example.test',
        imapPort: 993,
        imapUsername: 'p2@example.test',
        inboundSyncEnabled: false,
        outboundSendEnabled: false,
        fromAddress: 'p2@example.test',
        fromName: 'P2 local fixture',
      },
    });
    configurationId = row.id;
  });

  afterAll(async () => {
    if (prisma) {
      if (configurationId) {
        const checkpoints = await prisma.mailEvidenceFolderCheckpoint.findMany({
          where: { mailConfigurationId: configurationId },
          select: { id: true },
        });
        await prisma.mailSentObservation.deleteMany({
          where: { folderCheckpointId: { in: checkpoints.map((item) => item.id) } },
        });
        await prisma.mailEvidenceFolderCheckpoint.deleteMany({
          where: { mailConfigurationId: configurationId },
        });
        await prisma.mailConfiguration.delete({ where: { id: configurationId } });
      }
      if (issuerId) await prisma.billingEntity.delete({ where: { id: issuerId } });
      await prisma.$disconnect();
    }
  });

  it('creates independent Sent and sent checkpoints without enabling polling', async () => {
    const first = await prisma.mailEvidenceFolderCheckpoint.create({
      data: {
        mailConfigurationId: configurationId,
        folderName: 'Sent',
        folderIdentityKey: mailEvidenceFolderIdentityKey('Sent'),
        sourceKind: 'SENT',
      },
    });
    expect(first.syncEnabled).toBe(false);
    expect(first.uidValidity).toBeNull();
    expect(first.lastUid).toBeNull();
    expect(first.capability).toBe('UNPROBED');

    const second = await prisma.mailEvidenceFolderCheckpoint.create({
      data: {
        mailConfigurationId: configurationId,
        folderName: 'sent',
        folderIdentityKey: mailEvidenceFolderIdentityKey('sent'),
        sourceKind: 'SENT',
      },
    });
    expect(second.folderIdentityKey).not.toBe(first.folderIdentityKey);
    expect(await prisma.mailEvidenceFolderCheckpoint.count({
      where: { mailConfigurationId: configurationId },
    })).toBe(2);
  });

  it('enforces unique exact-folder source identity and mailbox foreign key independently', async () => {
    const name = 'Duplicate-key fixture';
    const identity = mailEvidenceFolderIdentityKey(name);
    await prisma.mailEvidenceFolderCheckpoint.create({
      data: {
        mailConfigurationId: configurationId,
        folderName: name,
        folderIdentityKey: identity,
        sourceKind: 'SENT',
      },
    });
    await expect(prisma.mailEvidenceFolderCheckpoint.create({
      data: {
        mailConfigurationId: configurationId,
        folderName: name,
        folderIdentityKey: identity,
        sourceKind: 'SENT',
      },
    })).rejects.toThrow();

    await expect(prisma.mailEvidenceFolderCheckpoint.create({
      data: {
        mailConfigurationId: randomUUID(),
        folderName: 'Sent',
        folderIdentityKey: mailEvidenceFolderIdentityKey('Sent'),
        sourceKind: 'SENT',
      },
    })).rejects.toThrow();
  });

  it('uses a database conditional update so only one racing cursor advance wins, in isolation', async () => {
    const name = 'Cursor CAS fixture';
    const row = await prisma.mailEvidenceFolderCheckpoint.create({
      data: {
        mailConfigurationId: configurationId,
        folderName: name,
        folderIdentityKey: mailEvidenceFolderIdentityKey(name),
        sourceKind: 'SENT',
      },
    });
    await prisma.mailEvidenceFolderCheckpoint.update({
      where: { id: row.id },
      data: { uidValidity: 100n, lastUid: 42n },
    });
    const claims = await Promise.all([
      prisma.mailEvidenceFolderCheckpoint.updateMany({
        where: { id: row.id, uidValidity: 100n, lastUid: 42n },
        data: { lastUid: 43n },
      }),
      prisma.mailEvidenceFolderCheckpoint.updateMany({
        where: { id: row.id, uidValidity: 100n, lastUid: 42n },
        data: { lastUid: 43n },
      }),
    ]);
    expect(claims.map((result) => result.count).sort()).toEqual([0, 1]);
    const persisted = await prisma.mailEvidenceFolderCheckpoint.findUniqueOrThrow({
      where: { id: row.id },
    });
    expect(persisted.uidValidity).toBe(100n);
    expect(persisted.lastUid).toBe(43n);
    expect(persisted.syncEnabled).toBe(false);
  });

  it('stores a distinct Sent observation as UNKNOWN and rejects duplicate source identities', async () => {
    const name = 'Sent evidence ledger fixture';
    const checkpoint = await prisma.mailEvidenceFolderCheckpoint.create({
      data: {
        mailConfigurationId: configurationId,
        folderName: name,
        folderIdentityKey: mailEvidenceFolderIdentityKey(name),
        sourceKind: 'SENT',
      },
    });
    const sourceIdentityKey = computeImapIdentityKey({
      mailConfigurationId: configurationId,
      canonicalFolder: name,
      uidValidity: 778n,
      uid: 25n,
    });
    const observation = await prisma.mailSentObservation.create({
      data: {
        folderCheckpointId: checkpoint.id,
        sourceIdentityKey,
        uidValidity: 778n,
        uid: 25n,
        messageIdHeader: '<ID@sender.test>',
        parseFailed: false,
      },
    });
    expect(observation.deliveryStatus).toBe('UNKNOWN');
    expect(observation.messageIdHeader).toBe('<ID@sender.test>');

    // A different source identity cannot bypass the checkpoint/epoch/UID
    // uniqueness constraint for the same physical mailbox item.
    await expect(prisma.mailSentObservation.create({
      data: {
        folderCheckpointId: checkpoint.id,
        sourceIdentityKey: computeImapIdentityKey({
          mailConfigurationId: 'malformed-different-scope',
          canonicalFolder: name,
          uidValidity: 778n,
          uid: 25n,
        }),
        uidValidity: 778n,
        uid: 25n,
      },
    })).rejects.toThrow();

    await expect(prisma.mailSentObservation.create({
      data: {
        folderCheckpointId: checkpoint.id,
        sourceIdentityKey,
        uidValidity: 778n,
        uid: 25n,
      },
    })).rejects.toThrow();

    // The P2.C ledger is metadata only: even an accidental code path trying
    // to mark delivery cannot override the database's UNKNOWN-only check.
    await expect(prisma.mailSentObservation.update({
      where: { id: observation.id },
      data: { deliveryStatus: 'DELIVERED' },
    })).rejects.toThrow();
    await expect(prisma.mailSentObservation.create({
      data: {
        folderCheckpointId: checkpoint.id,
        sourceIdentityKey: computeImapIdentityKey({
          mailConfigurationId: configurationId,
          canonicalFolder: name,
          uidValidity: 778n,
          uid: 0n,
        }),
        uidValidity: 778n,
        uid: 0n,
      },
    })).rejects.toThrow();
    expect(await prisma.mailSentObservation.count({ where: { folderCheckpointId: checkpoint.id } }))
      .toBe(1);
    expect((await prisma.mailEvidenceFolderCheckpoint.findUniqueOrThrow({
      where: { id: checkpoint.id },
    })).lastUid).toBeNull();
  });

  it('commits a Sent evidence row and new cursor once under two competing transactions', async () => {
    const folder = 'Atomic sent ledger fixture';
    const row = await prisma.mailEvidenceFolderCheckpoint.create({
      data: {
        mailConfigurationId: configurationId,
        folderName: folder,
        folderIdentityKey: mailEvidenceFolderIdentityKey(folder),
        sourceKind: 'SENT',
        capability: 'AVAILABLE',
        syncEnabled: true, // CI-local opt-in; production default remains OFF.
        uidValidity: 700n,
        lastUid: 44n,
      },
    });
    const sourceIdentityKey = computeImapIdentityKey({
      mailConfigurationId: configurationId,
      canonicalFolder: folder,
      uidValidity: 700n,
      uid: 45n,
    });
    const checkpoint = {
      id: row.id,
      mailConfigurationId: configurationId,
      folderName: folder,
      folderIdentityKey: row.folderIdentityKey,
      sourceKind: 'SENT',
      capability: 'AVAILABLE',
      syncEnabled: true,
      uidValidity: 700n,
      lastUid: 44n,
    };
    const preview = {
      outcome: 'PREVIEW_ONLY' as const,
      observations: [{
        sourceIdentityKey,
        uid: 45n,
        internalDate: new Date('2026-11-23T12:00:00.000Z'),
        messageIdHeader: '<Atomic@Example.test>',
        parseFailed: false,
        deliveryStatus: 'UNKNOWN' as const,
      }],
      highestObservedUid: 45n,
    };

    // Both callers begin with the same checkpoint snapshot and same preview.
    // The winner inserts exactly one observation and advances one new cursor.
    // The loser must never insert another row or advance the old INBOX cursor.
    const outcomes = await Promise.allSettled([
      commitSentObservationPreview(prisma as never, checkpoint, preview),
      commitSentObservationPreview(prisma as never, checkpoint, preview),
    ]);
    expect(outcomes.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((item) => item.status === 'rejected')).toHaveLength(1);

    const saved = await prisma.mailSentObservation.findMany({
      where: { folderCheckpointId: row.id },
    });
    expect(saved).toHaveLength(1);
    expect(saved[0]?.sourceIdentityKey).toBe(sourceIdentityKey);
    expect(saved[0]?.deliveryStatus).toBe('UNKNOWN');
    expect((await prisma.mailEvidenceFolderCheckpoint.findUniqueOrThrow({
      where: { id: row.id },
    })).lastUid).toBe(45n);

    const inbox = await prisma.mailConfiguration.findUniqueOrThrow({ where: { id: configurationId } });
    expect(inbox.inboundSyncEnabled).toBe(false);
    expect(inbox.lastSyncUidValidity).toBeNull();
    expect(inbox.lastSyncUid).toBeNull();
  });

  it('does not move Sent cursor if an observation insert conflicts with existing evidence', async () => {
    const folder = 'Sent duplicate evidence fixture';
    const row = await prisma.mailEvidenceFolderCheckpoint.create({
      data: {
        mailConfigurationId: configurationId,
        folderName: folder,
        folderIdentityKey: mailEvidenceFolderIdentityKey(folder),
        sourceKind: 'SENT',
        capability: 'AVAILABLE',
        syncEnabled: true,
        uidValidity: 999n,
        lastUid: 1n,
      },
    });
    const sourceIdentityKey = computeImapIdentityKey({
      mailConfigurationId: configurationId,
      canonicalFolder: folder,
      uidValidity: 999n,
      uid: 2n,
    });
    await prisma.mailSentObservation.create({
      data: {
        folderCheckpointId: row.id,
        sourceIdentityKey,
        uidValidity: 999n,
        uid: 2n,
      },
    });
    const checkpoint = {
      id: row.id, mailConfigurationId: configurationId,
      folderName: folder, folderIdentityKey: row.folderIdentityKey,
      sourceKind: 'SENT', capability: 'AVAILABLE', syncEnabled: true,
      uidValidity: 999n, lastUid: 1n,
    };
    await expect(commitSentObservationPreview(prisma as never, checkpoint, {
      outcome: 'PREVIEW_ONLY',
      observations: [{
        sourceIdentityKey, uid: 2n, internalDate: null,
        messageIdHeader: '<duplicate@sender.test>', parseFailed: false,
        deliveryStatus: 'UNKNOWN',
      }],
      highestObservedUid: 2n,
    })).rejects.toThrow();
    expect((await prisma.mailEvidenceFolderCheckpoint.findUniqueOrThrow({
      where: { id: row.id },
    })).lastUid).toBe(1n);
    expect(await prisma.mailSentObservation.count({
      where: { folderCheckpointId: row.id },
    })).toBe(1);
  });

  it('preserves an ESTABLISHED legacy INBOX cursor even after creating an unrelated Sent checkpoint', async () => {
    await prisma.mailConfiguration.update({
      where: { id: configurationId },
      data: {
        lastSyncUidValidity: 900n,
        lastSyncUid: 77n,
        inboundSyncEnabled: false,
      },
    });
    const name = 'Independent Sent Folder For Legacy Preservation';
    await prisma.mailEvidenceFolderCheckpoint.create({
      data: {
        mailConfigurationId: configurationId,
        folderName: name,
        folderIdentityKey: mailEvidenceFolderIdentityKey(name),
        sourceKind: 'SENT',
      },
    });
    const config = await prisma.mailConfiguration.findUniqueOrThrow({
      where: { id: configurationId },
    });
    expect(config.lastSyncUidValidity).toBe(900n);
    expect(config.lastSyncUid).toBe(77n);
    expect(config.inboundSyncEnabled).toBe(false);
    const checkpoints = await prisma.mailEvidenceFolderCheckpoint.findMany({
      where: { mailConfigurationId: configurationId },
    });
    expect(checkpoints.every((record) => !record.syncEnabled)).toBe(true);
  });
});
