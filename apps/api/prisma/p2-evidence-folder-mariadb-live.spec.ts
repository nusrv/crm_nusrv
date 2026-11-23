import { randomUUID } from 'node:crypto';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../src/generated/prisma/client';
import { PaymentScope } from '../src/generated/prisma/enums';
import { toMariaDbDriverUrl } from '../src/database/mariadb-url';
import { mailEvidenceFolderIdentityKey } from '../src/modules/mail/mail-evidence-folder-identity';

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
