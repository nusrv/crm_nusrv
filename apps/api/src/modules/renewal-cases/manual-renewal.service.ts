import { summarizeSmtpEvidence } from '../mail/smtp-evidence-summary';
import { randomUUID, createHash } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { AuditService } from '../../audit/audit.service';
import { PrismaService } from '../../database/prisma.service';
import type { CommunicationOutbox, Prisma, RenewalCase } from '../../generated/prisma/client';
import { ActorType } from '../../generated/prisma/enums';
import { CustomerEmailResolutionService } from '../customers/customer-email-resolution.service';
import { hasRecordedSmtpAcceptance, resendAuthorizationSchema } from '../mail/outbound-resend-policy';
import { renewalRecipients, type RenewalRecipient } from './renewal-mail-recipient';
import { isReminderEligible } from './renewal-policy';

const caseInclude = { subscription: { include: { customer: true, identifiers: { where: { active: true } } } } } as const;
const reviewable = ['UPCOMING', 'REMINDER_CYCLE', 'AWAITING_CUSTOMER', 'HUMAN_REVIEW'] as const;
type Purpose = 'REMINDER' | 'CLARIFICATION';
const sendSchema = z.object({
  recipient: z.email().max(320),
  recipientContactId: z.uuid().nullable().optional(),
  purpose: z.enum(['REMINDER', 'CLARIFICATION']).default('REMINDER'),
  subject: z.string().trim().min(1).max(500).regex(/^[^\r\n]+$/),
  body: z.string().trim().min(1).max(60000),
  idempotencyKey: z.uuid(),
}).strict();

export function readableRenewalReference(id: string, dueDate: Date) {
  return `RNW-${dueDate.getUTCFullYear()}-${createHash('sha256').update(id).digest('hex').slice(0, 10).toUpperCase()}`;
}

function requireSendEligibility(row: RenewalCase, purpose: Purpose) {
  const eligible = purpose === 'CLARIFICATION'
    ? row.status === 'HUMAN_REVIEW' && row.clarificationPending
    : isReminderEligible(row.status) && !row.clarificationPending;
  if (!eligible) throw new ConflictException('This case does not currently permit this message.');
}

@Injectable()
export class ManualRenewalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly emails: CustomerEmailResolutionService,
  ) {}

  async prepare(id: string) {
    const row = await this.prisma.renewalCase.findUnique({ where: { id }, include: caseInclude });
    if (!row) throw new NotFoundException('Renewal case not found.');
    const purpose = row.clarificationPending ? 'CLARIFICATION' : 'REMINDER';
    requireSendEligibility(row, purpose);
    const sub = row.subscription;
    const { options, defaultRecipient } = await renewalRecipients(this.prisma, this.emails, sub.customerId);
    const recipientName = defaultRecipient?.name || sub.customer.contactName || sub.customer.nameEn || sub.customer.nameAr || 'Customer';
    const reference = readableRenewalReference(id, row.dueDate);
    const identifiers = sub.identifiers.map((item) => item.value).join(', ');
    const subject = purpose === 'CLARIFICATION'
      ? `[${reference}] Renewal clarification — ${sub.name}`
      : `[${reference}] Renewal confirmation — ${sub.name}`;
    const body = purpose === 'CLARIFICATION'
      ? ''
      : `Dear ${recipientName},\n\nPlease confirm renewal of ${sub.name}${identifiers ? ' (' + identifiers + ')' : ''}.\nRenewal due: ${row.dueDate.toISOString().slice(0, 10)}\nRenewal term: ${sub.renewalIntervalMonths ?? 'Not configured'} months\nAmount: ${sub.sellingPrice.toString()} ${sub.currency}\n\nPlease reply to confirm renewal or let us know if you need clarification.\n\nReference: ${reference}`;
    return {
      purpose, options, recipient: defaultRecipient?.email ?? null, recipientContactId: defaultRecipient?.contactId ?? null,
      recipientName, reference, subject, body, customerId: sub.customerId,
      customer: sub.customer.nameEn || sub.customer.nameAr, service: sub.name, dueDate: row.dueDate,
      termMonths: sub.renewalIntervalMonths, amount: sub.sellingPrice.toString(), currency: sub.currency,
    };
  }

  async send(id: string, value: unknown, actorId: string) {
    const parsed = sendSchema.safeParse(value);
    if (!parsed.success) throw new BadRequestException('Valid recipient, subject, message and request identity are required.');
    const input = parsed.data;
    const key = `manual-renewal:${actorId}:${input.idempotencyKey}`;
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.communicationOutbox.findUnique({ where: { idempotencyKey: key } });
      if (existing) {
        if (existing.renewalCaseId !== id || existing.recipient !== input.recipient ||
            existing.body !== input.body || existing.subject !== input.subject ||
            (existing.purpose ?? 'REMINDER') !== input.purpose ||
            (input.recipientContactId !== undefined && existing.recipientContactId !== input.recipientContactId)) {
          throw new ConflictException('Request identity already used for a different message.');
        }
        return existing;
      }
      const row = await tx.renewalCase.findUnique({ where: { id }, include: caseInclude });
      if (!row) throw new NotFoundException('Renewal case not found.');
      requireSendEligibility(row, input.purpose);
      const reference = readableRenewalReference(id, row.dueDate);
      if (!input.subject.includes(`[${reference}]`)) throw new BadRequestException('Keep the renewal reference in the subject.');
      const recipient = await this.validateRecipient(tx, row.subscription.customerId, input.recipientContactId, input.recipient);
      const revision = await this.reserveCase(tx, row, input.purpose);
      return this.queue(tx, { caseId: id, subscriptionId: row.subscriptionId, customerId: row.subscription.customerId,
        recipient, actorId, key, purpose: input.purpose, revision, subject: input.subject, body: input.body });
    });
  }

  async review(id: string, pending: boolean, actorId: string, input?: unknown) {
    const parsed = z.object({ messageId: z.uuid() }).strict().safeParse(input);
    if (!parsed.success) throw new BadRequestException('Select the inbound reply being reviewed.');
    const { messageId } = parsed.data;
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM renewal_cases WHERE id = ${id} FOR UPDATE`;
      const row = await tx.renewalCase.findUnique({ where: { id } });
      if (!row || !reviewable.some(status => status === row.status)) throw new ConflictException('The current renewal state cannot enter review.');
      const reply = await tx.emailMessage.findFirst({ where: { id: messageId, renewalCaseId: id, direction: 'INBOUND' }, select: { id: true } });
      if (!reply) throw new NotFoundException('Inbound message not found.');
      if (pending) {
        await tx.renewalCase.update({ where: { id }, data: { status: 'HUMAN_REVIEW', customerDecision: 'UNDECIDED', clarificationPending: true, communicationRevision: { increment: 1 } } });
      }
      const read = await tx.emailMessage.updateMany({ where: { id: messageId, renewalCaseId: id, direction: 'INBOUND', reviewedAt: null }, data: { reviewedAt: new Date(), reviewedBy: actorId } });
      if (read.count) await this.audit.record({ actorType: ActorType.USER, actorId, eventKey: 'renewal.reply.reviewed', subjectType: 'EmailMessage', subjectId: messageId, metadata: { renewalCaseId: id } }, tx);
      await this.audit.record({
        actorType: ActorType.USER, actorId, subjectType: 'RenewalCase', subjectId: id,
        eventKey: pending ? 'renewal.case.needs_clarification' : 'renewal.case.kept_in_review',
        metadata: { messageId, clarificationPending: pending ? true : row.clarificationPending },
      }, tx);
      return tx.renewalCase.findUniqueOrThrow({ where: { id } });
    });
  }

  async resend(id: string, outboxId: string, value: unknown, actorId: string) {
    const parsed = resendAuthorizationSchema.safeParse(value);
    if (!parsed.success) throw new BadRequestException('Acknowledge the risk of duplicate delivery before resending.');
    const key = `manual-renewal-resend:${actorId}:${parsed.data.idempotencyKey}`;
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.communicationOutbox.findUnique({ where: { idempotencyKey: key } });
      if (existing) {
        if (existing.renewalCaseId !== id || existing.resendOfId !== outboxId)
          throw new ConflictException('Request identity already used for a different message.');
        return existing;
      }
      const original = await tx.communicationOutbox.findFirst({ where: { id: outboxId, renewalCaseId: id } });
      if (!original || original.audience !== 'CUSTOMER' || !original.manualApprovedBy)
        throw new NotFoundException('Customer message not found.');
      if (original.status !== 'FAILED' || !original.smtpUncertain ||
          await hasRecordedSmtpAcceptance(tx, 'CommunicationOutbox', outboxId) ||
          await tx.communicationOutbox.findUnique({ where: { resendOfId: outboxId } }))
        throw new ConflictException('This message is not eligible for an authorized resend.');
      const row = await tx.renewalCase.findUnique({ where: { id }, include: caseInclude });
      if (!row) throw new NotFoundException('Renewal case not found.');
      const purpose = original.purpose === 'CLARIFICATION' ? 'CLARIFICATION' : 'REMINDER';
      requireSendEligibility(row, purpose);
      if (purpose === 'CLARIFICATION' && row.communicationRevision !== original.caseRevision)
        throw new ConflictException('This clarification has been superseded.');
      const recipient = await this.validateRecipient(tx, original.customerId, original.recipientContactId, original.recipient);
      const revision = await this.reserveCase(tx, row, purpose);
      return this.queue(tx, {
        caseId: id, subscriptionId: row.subscriptionId, customerId: original.customerId,
        recipient, actorId, key, purpose, revision, subject: original.subject, body: original.body, resendOfId: outboxId,
      });
    });
  }

  async evidence(id: string, outboxId: string) {
    const row = await this.prisma.communicationOutbox.findFirst({
      where: { id: outboxId, renewalCaseId: id },
      select: { id: true, attempts: true, smtpUncertain: true, resendOfId: true, status: true, lastError: true },
    });
    if (!row) throw new NotFoundException('Message not found.');
    const events = await this.prisma.auditEvent.findMany({
      where: { subjectId: outboxId, subjectType: 'CommunicationOutbox' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, eventKey: true, actorId: true, actorType: true, metadata: true, createdAt: true },
      take: 101,
    });
    return { ...row, events: events.slice(0, 100), smtpEvidence: summarizeSmtpEvidence('CommunicationOutbox', events, events.length > 100) };
  }

  async replies(id: string) {
    return this.prisma.emailMessage.findMany({ where: { renewalCaseId: id }, orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }], take: 100 });
  }

  async markRead(id: string, messageId: string, actorId: string, read = true) {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.emailMessage.updateMany({
        where: { id: messageId, renewalCaseId: id, direction: 'INBOUND', reviewedAt: read ? null : { not: null } },
        data: { reviewedAt: read ? new Date() : null, reviewedBy: read ? actorId : null },
      });
      if (result.count) {
        await this.audit.record({
          actorType: ActorType.USER, actorId, eventKey: read ? 'renewal.reply.reviewed' : 'renewal.reply.marked_unread',
          subjectType: 'EmailMessage', subjectId: messageId, metadata: { renewalCaseId: id },
        }, tx);
      } else if (!(await tx.emailMessage.findFirst({ where: { id: messageId, renewalCaseId: id, direction: 'INBOUND' }, select: { id: true } }))) {
        throw new NotFoundException('Inbound message not found.');
      }
      return { reviewed: read };
    });
  }

  private async validateRecipient(tx: Prisma.TransactionClient, customerId: string, contactId: string | null | undefined, email: string) {
    const { defaultRecipient, options } = await renewalRecipients(tx, this.emails, customerId);
    const selected = contactId === undefined ? defaultRecipient : options.find((entry) => entry.contactId === contactId);
    if (!selected || selected.email !== email)
      throw new BadRequestException('The selected address is no longer registered for this customer.');
    return selected;
  }

  private async reserveCase(tx: Prisma.TransactionClient, row: RenewalCase, purpose: Purpose) {
    const changed = await tx.renewalCase.updateMany({
      where: { id: row.id, status: row.status, communicationRevision: row.communicationRevision },
      data: {
        lastCustomerContactAt: new Date(),
        ...(purpose === 'CLARIFICATION' ? { communicationRevision: { increment: 1 } } : {}),
      },
    });
    if (changed.count !== 1) throw new ConflictException('Renewal decision changed; message was not queued.');
    return purpose === 'CLARIFICATION' ? row.communicationRevision + 1 : row.communicationRevision;
  }

  private async queue(tx: Prisma.TransactionClient, input: {
    caseId: string; customerId: string; subscriptionId: string; recipient: RenewalRecipient; actorId: string;
    key: string; purpose: Purpose; revision: number | null; subject: string; body: string; resendOfId?: string;
  }): Promise<CommunicationOutbox> {
    const outboxId = randomUUID();
    const audit = await this.audit.record({
      actorType: ActorType.USER, actorId: input.actorId,
      eventKey: input.resendOfId ? 'renewal.reminder.resend_authorized' : 'renewal.reminder.human_send',
      subjectType: 'CommunicationOutbox', subjectId: outboxId,
      metadata: {
        renewalCaseId: input.caseId, recipient: input.recipient.email, contactId: input.recipient.contactId,
        purpose: input.purpose, caseRevision: input.revision, resendOfId: input.resendOfId,
        ...(input.resendOfId ? { duplicateRiskAcknowledged: true } : {}),
      },
    }, tx);
    return tx.communicationOutbox.create({
      data: {
        id: outboxId, customerId: input.customerId, subscriptionId: input.subscriptionId, renewalCaseId: input.caseId,
        auditEventId: audit.id, audience: 'CUSTOMER', recipient: input.recipient.email, recipientContactId: input.recipient.contactId,
        subject: input.subject, body: input.body, daysBeforeDue: 0, scheduledAt: new Date(), idempotencyKey: input.key,
        manualApprovedBy: input.actorId, purpose: input.purpose, caseRevision: input.revision, resendOfId: input.resendOfId,
      },
    });
  }
}
