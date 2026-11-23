import { randomUUID } from 'node:crypto';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../src/generated/prisma/client';
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
  let configurationId: string;

  beforeAll(async () => {
    prisma = new PrismaClient({
      adapter: new PrismaMariaDb(toMariaDbDriverUrl(disposableDatabase(testUrl!))),
    });
    const row = await prisma.mailConfiguration.create({
      data: {
        scopeKey: `P2_TEST:${randomUUID()}`,
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

  it('enforces unique exact-folder source identity and mailbox foreign key', async () => {
    await expect(prisma.mailEvidenceFolderCheckpoint.create({
      data: {
        mailConfigurationId: configurationId,
        folderName: 'Sent',
        folderIdentityKey: mailEvidenceFolderIdentityKey('Sent'),
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

  it('preserves and does not overwrite the legacy INBOX cursor', async () => {
    const config = await prisma.mailConfiguration.findUniqueOrThrow({
      where: { id: configurationId },
    });
    expect(config.lastSyncUidValidity).toBeNull();
    expect(config.lastSyncUid).toBeNull();
    expect(config.inboundSyncEnabled).toBe(false);
    const checkpoints = await prisma.mailEvidenceFolderCheckpoint.findMany({
      where: { mailConfigurationId: configurationId },
    });
    expect(checkpoints.every((record) => !record.syncEnabled)).toBe(true);
  });
});
