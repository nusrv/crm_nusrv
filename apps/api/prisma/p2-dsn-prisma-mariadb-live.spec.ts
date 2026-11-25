import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../src/audit/audit.service';
import { PrismaService } from '../src/database/prisma.service';
import { parseDsnCandidate } from '../src/modules/mail/dsn-candidate-parser';
import { commitCorroboratedDsnObservation } from '../src/modules/mail/dsn-follow-up-transaction';
import { resolveDsnFollowUp } from '../src/modules/mail/dsn-follow-up-resolution';
import { createPrismaDsnEvidenceStore, createPrismaDsnResolutionStore } from '../src/modules/mail/dsn-prisma-store';
import { resolveCurrentProviderBinding } from '../src/modules/mail/mail-provider-binding';
import { mailEvidenceFolderIdentityKey } from '../src/modules/mail/mail-evidence-folder-identity';
import type { VerifiedDsnProvenance } from '../src/modules/mail/dsn-follow-up-plan';

const url = process.env.MARIADB_TEST_DATABASE_URL;
const live = url ? describe : describe.skip;
function disposable(input: string): string {
  const parsed = new URL(input);
  if (parsed.protocol !== 'mysql:' || parsed.hostname !== '127.0.0.1' ||
      parsed.port !== '3306' || parsed.pathname !== '/nusrv_rehearsal_test' ||
      !parsed.username || !parsed.password || /^(root|admin)$/i.test(decodeURIComponent(parsed.username)) ||
      parsed.search || parsed.hash || process.env.DATABASE_URL !== input) {
    throw new Error('Use only the dedicated loopback nusrv_rehearsal_test schema and matching DATABASE_URL.');
  }
  return input;
}

// This fixture retains append-only evidence. Discard the entire dedicated
// disposable schema externally after testing; never delete evidence in production.
live('P2 concrete DSN persistence on disposable MariaDB (synthetic provider proof)', () => {
  let prisma: PrismaService;
  let audit: AuditService;
  beforeAll(() => {
    prisma = new PrismaService(new ConfigService({ DATABASE_URL: disposable(url!) }));
    audit = new AuditService(prisma);
  });
  afterAll(async () => { await prisma?.$disconnect(); });

  async function fixture() {
    const issuer = await prisma.billingEntity.create({ data: {
      code: 'DSN-' + randomUUID(), customerCodePrefix: 'D' + randomUUID().slice(0, 6).toUpperCase(),
      name: 'Disposable DSN fixture', legalName: 'Disposable DSN fixture', paymentScope: 'LOCAL',
    } });
    const mail = await prisma.mailConfiguration.create({ data: {
      billingEntityId: issuer.id, scopeKey: 'BILLING_ENTITY:' + issuer.id, label: 'Disposable DSN',
      smtpHost: 'no-network.example.test', smtpPort: 587, smtpUsername: 'fixture@example.test',
      imapHost: 'no-network.example.test', imapPort: 993, imapUsername: 'fixture@example.test',
      fromAddress: 'fixture@example.test', fromName: 'Fixture', enabled: true,
      environment: 'SANDBOX', inboundSyncEnabled: false, outboundSendEnabled: false,
    } });
    const account = { mailConfigurationId: mail.id, generation: randomUUID(), providerNamespace: 'fixture-provider',
      providerAccountId: 'fixture-' + randomUUID() };
    const snapshot = { ...account, enabled: true, observationEnabled: true };
    const bound = resolveCurrentProviderBinding(snapshot, snapshot, account);
    if (bound.outcome !== 'BOUND') throw new Error('Invalid synthetic binding');
    await prisma.mailProviderEvidenceBinding.create({ data: {
      ...account, currentMailboxKey: mail.id, sourceBindingKey: bound.binding.sourceBindingKey, observationEnabled: true,
    } });
    const proof: VerifiedDsnProvenance = {
      subject: { type: 'CommunicationOutbox', id: randomUUID() },
      mailConfigurationId: mail.id, sourceObjectId: 'fixture-' + randomUUID(), folder: 'INBOX',
      originalMessageId: '<' + randomUUID() + '@example.test>', attemptId: randomUUID(),
      envelopeRecipient: 'billing@example.test', enhancedStatus: '5.1.1',
    };
    for (const [eventKey, metadata] of [
      ['mail.send.attempt_started', { attemptId: proof.attemptId, mailConfigurationId: mail.id,
        messageId: proof.originalMessageId, recipient: proof.envelopeRecipient }],
      ['mail.send.succeeded', { attemptId: proof.attemptId, acceptance: { source: 'smtp', responseCode: 250 } }],
    ] as const) {
      await audit.record({ actorType: 'SYSTEM', eventKey, subjectType: proof.subject.type, subjectId: proof.subject.id, metadata });
    }
    const report = (sourceObjectId = proof.sourceObjectId) => {
      const provenance = { ...proof, sourceObjectId };
      const candidate = parseDsnCandidate({
        mailConfigurationId: mail.id, sourceObjectId, outerContentType: 'multipart/report; report-type=delivery-status',
        reportPartContentType: 'message/delivery-status',
        reportPartText: 'Reporting-MTA: dns; mx.example.test\r\n\r\nFinal-Recipient: rfc822; billing@example.test\r\nAction: failed\r\nStatus: 5.1.1',
      });
      if (candidate.kind !== 'CANDIDATE_DSN') throw new Error('Invalid DSN fixture');
      return { account, provenance, candidate };
    };
    const actor = await prisma.user.create({ data: { email: randomUUID() + '@example.test', displayName: 'Fixture ADMIN', passwordHash: 'fixture-only' } });
    const role = await prisma.role.upsert({ where: { code: 'ADMIN' }, create: { code: 'ADMIN', name: 'Administrator' }, update: {} });
    await prisma.userRole.create({ data: { userId: actor.id, roleId: role.id } });
    const session = await prisma.authSession.create({ data: {
      userId: actor.id, refreshTokenHash: 'fixture-only', expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    } });
    return { mail, account, snapshot, report, actor, role, session };
  }

  it('serializes duplicate observation writes, resolves once, and retains later evidence without reopening', async () => {
    const f = await fixture();
    const store = createPrismaDsnEvidenceStore(prisma, audit);
    const outcomes = await Promise.all([
      commitCorroboratedDsnObservation(store, f.snapshot, f.report()),
      commitCorroboratedDsnObservation(store, f.snapshot, f.report()),
    ]);
    expect(outcomes.map(x => x.outcome).sort()).toEqual(['NO_CHANGE', 'RECORDED']);
    const task = await prisma.mailDsnFollowUp.findFirstOrThrow({ where: { mailConfigurationId: f.mail.id } });
    expect(await prisma.mailDsnObservation.count({ where: { mailConfigurationId: f.mail.id } })).toBe(1);
    const resolution = createPrismaDsnResolutionStore(prisma, audit);
    const context = { actorId: f.actor.id, sessionId: f.session.id };
    const cmd = { taskId: task.id, expectedRevision: 1, reason: 'Reviewed fixture' };
    const results = await Promise.all([resolveDsnFollowUp(resolution, context, cmd, () => new Date()),
      resolveDsnFollowUp(resolution, context, cmd, () => new Date())]);
    expect(results.map(x => x.outcome).sort()).toEqual(['NO_CHANGE', 'RESOLVED']);
    expect(await commitCorroboratedDsnObservation(store, f.snapshot, f.report(randomUUID())))
      .toEqual({ outcome: 'RECORDED', taskCreated: false });
    expect(await prisma.mailDsnFollowUp.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({ status: 'RESOLVED', revision: 2, resolvedById: f.actor.id });
    expect(await prisma.mailDsnObservation.count({ where: { mailConfigurationId: f.mail.id } })).toBe(2);
    expect(await prisma.auditEvent.count({ where: { subjectType: 'MailDsnFollowUp', subjectId: task.id, eventKey: 'mail.dsn.follow_up.resolved' } })).toBe(1);
    const observation = await prisma.mailDsnObservation.findFirstOrThrow({ where: { mailConfigurationId: f.mail.id } });
    await expect(prisma.mailDsnObservation.update({ where: { id: observation.id }, data: { enhancedStatus: '5.2.2' } })).rejects.toThrow();
    await expect(prisma.mailDsnObservation.delete({ where: { id: observation.id } })).rejects.toThrow();
  }, 120_000);

  it('rolls back both task and evidence when audit fails, then allows an explicit fresh attempt', async () => {
    const f = await fixture();
    const failing = createPrismaDsnEvidenceStore(prisma, { record() { throw new Error('Fixture audit failure'); } });
    await expect(commitCorroboratedDsnObservation(failing, f.snapshot, f.report())).rejects.toThrow('Fixture audit failure');
    expect(await prisma.mailDsnFollowUp.count({ where: { mailConfigurationId: f.mail.id } })).toBe(0);
    expect(await prisma.mailDsnObservation.count({ where: { mailConfigurationId: f.mail.id } })).toBe(0);
    expect(await commitCorroboratedDsnObservation(createPrismaDsnEvidenceStore(prisma, audit), f.snapshot, f.report()))
      .toEqual({ outcome: 'RECORDED', taskCreated: true });
  }, 120_000);

  it('retires binding and disables Sent on material changes without altering either cursor; health updates do not retire', async () => {
    const f = await fixture();
    const cp = await prisma.mailEvidenceFolderCheckpoint.create({ data: {
      mailConfigurationId: f.mail.id, folderName: 'Sent', folderIdentityKey: mailEvidenceFolderIdentityKey('Sent'),
      sourceKind: 'SENT', syncEnabled: true, capability: 'AVAILABLE', uidValidity: 22n, lastUid: 17n,
    } });
    await prisma.mailConfiguration.update({ where: { id: f.mail.id }, data: { lastSyncedAt: new Date(), lastSyncUidValidity: 44n, lastSyncUid: 10n } });
    expect((await prisma.mailProviderEvidenceBinding.findUniqueOrThrow({ where: { generation: f.account.generation } })).currentMailboxKey).toBe(f.mail.id);
    await prisma.mailConfiguration.update({ where: { id: f.mail.id }, data: { imapUsername: 'other@example.test' } });
    await prisma.mailConfiguration.update({ where: { id: f.mail.id }, data: { imapUsername: f.mail.imapUsername } });
    expect(await prisma.mailProviderEvidenceBinding.findUniqueOrThrow({ where: { generation: f.account.generation } }))
      .toMatchObject({ currentMailboxKey: null, observationEnabled: false });
    expect(await prisma.mailEvidenceFolderCheckpoint.findUniqueOrThrow({ where: { id: cp.id } }))
      .toMatchObject({ syncEnabled: false, capability: 'UNPROBED', uidValidity: 22n, lastUid: 17n });
    expect(await prisma.mailConfiguration.findUniqueOrThrow({ where: { id: f.mail.id } }))
      .toMatchObject({ lastSyncUidValidity: 44n, lastSyncUid: 10n });
    expect((await commitCorroboratedDsnObservation(createPrismaDsnEvidenceStore(prisma, audit), f.snapshot, f.report())).outcome).toBe('REVIEW_ONLY');
    expect(await prisma.mailDsnFollowUp.count({ where: { mailConfigurationId: f.mail.id } })).toBe(0);
  }, 120_000);

  it('rejects resolution after session revocation or ADMIN role removal', async () => {
    const f = await fixture();
    await commitCorroboratedDsnObservation(createPrismaDsnEvidenceStore(prisma, audit), f.snapshot, f.report());
    const task = await prisma.mailDsnFollowUp.findFirstOrThrow({ where: { mailConfigurationId: f.mail.id } });
    const cmd = { taskId: task.id, expectedRevision: 1, reason: 'Fixture review' };
    const context = { actorId: f.actor.id, sessionId: f.session.id };
    const store = createPrismaDsnResolutionStore(prisma, audit);
    await prisma.userRole.delete({ where: { userId_roleId: { userId: f.actor.id, roleId: f.role.id } } });
    expect(await resolveDsnFollowUp(store, context, cmd, () => new Date())).toEqual({ outcome: 'FORBIDDEN' });
    await prisma.userRole.create({ data: { userId: f.actor.id, roleId: f.role.id } });
    await prisma.authSession.update({ where: { id: f.session.id }, data: { revokedAt: new Date() } });
    expect(await resolveDsnFollowUp(store, context, cmd, () => new Date())).toEqual({ outcome: 'FORBIDDEN' });
    expect(await prisma.mailDsnFollowUp.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({ status: 'OPEN', revision: 1 });
  }, 120_000);
});
