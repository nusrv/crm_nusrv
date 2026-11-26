import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../../audit/audit.service';
import { PrismaService } from '../../database/prisma.service';
import { ClockService } from '../../time/clock.service';
import type { MailConfiguration, Prisma } from '../../generated/prisma/client';
import {
  ActorType,
  CommunicationOutboxStatus,
  CustomerStatus,
  HealthStatus,
  MessageChannel,
  MessageDirection,
  ReminderAudience,
  SubscriptionStatus,
} from '../../generated/prisma/enums';
import { CustomerEmailResolutionService } from '../customers/customer-email-resolution.service';
import { aggregateEffectiveHolds, isReminderEligible } from '../renewal-cases/renewal-policy';
import {
  MailConfigurationResolverService,
  type MailConfigurationResolution,
} from './mail-configuration-resolver.service';
import { MailHealthService } from './mail-health.service';
import { hasRecordedSmtpAcceptance } from './outbound-resend-policy';
import { generateStableMessageId } from './mail-message-id.util';
import { MAIL_TRANSPORT, type MailTransport } from './mail-transport';
import { MailThreadResolutionService } from './mail-thread-resolution.service';
import { STALE_PROCESSING_LEASE_MS } from './mail-timing.constants';
import { classifySmtpError } from './smtp-error-classification';
import { dispatchSmtp, quarantineEligible, replayEligible, smtpFailure, UNCERTAIN_SMTP, type MailAcceptance } from './smtp-attempt-policy';
import { DEFER_RETRY_DELAY_MS, SMTP_RETRY_BACKOFF_MS } from '../communications/operator-reply-timing.constants';

/** Internal signal only — never escapes MailOutboundService. Thrown inside a guarded
 * updateMany()'s transaction to abort/roll back the whole transaction when the ownership CAS
 * predicate no longer matches, and caught immediately by the method that threw it. */
class OwnershipLostError extends Error {}

const outboxContextInclude = {
  customer: true,
  subscription: true,
  renewalCase: { include: { holds: { where: { active: true } } } },
  notificationRule: true,
  auditEvent: { select: { actorId: true, eventKey: true } },
} as const;

type OutboxContext = Prisma.CommunicationOutboxGetPayload<{ include: typeof outboxContextInclude }>;

type EligibilityResult =
  | {
      kind: 'eligible';
      mailConfiguration: MailConfiguration;
      recipient: string;
    }
  | { kind: 'defer'; reason: string }
  | { kind: 'cancel'; reason: string; metadata?: Record<string, unknown> };

export type OutboxProcessingOutcome =
  | 'sent'
  | 'deferred'
  | 'cancelled'
  | 'failed'
  | 'not_claimed'
  | 'conflict'
  | 'ownership_lost_after_send';

export interface MailBatchSummary {
  candidates: number;
  sent: number;
  deferred: number;
  cancelled: number;
  failed: number;
  notClaimed: number;
  conflicts: number;
  ownershipLostAfterSend: number;
}

/**
 * Claims only eligible queued rows. A claim token guards database writes, and the audit event
 * committed with the attempt counter marks the boundary before possible SMTP transmission.
 * Stale processing rows become uncertain. Late evidence is recorded without reopening them.
 */
@Injectable()
export class MailOutboundService {
  private static readonly BATCH_SIZE = 50;
  private static readonly MAX_SEND_ATTEMPTS = 5;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clock: ClockService,
    private readonly mailConfigResolver: MailConfigurationResolverService,
    private readonly threadResolution: MailThreadResolutionService,
    private readonly health: MailHealthService,
    private readonly emailResolution: CustomerEmailResolutionService,
    @Inject(MAIL_TRANSPORT) private readonly transport: MailTransport,
  ) {}

  async processBatch(): Promise<MailBatchSummary> {
    const summary: MailBatchSummary = {
      candidates: 0,
      sent: 0,
      deferred: 0,
      cancelled: 0,
      failed: 0,
      notClaimed: 0,
      conflicts: 0,
      ownershipLostAfterSend: 0,
    };

    const now = this.clock.now();
    const quarantinable = await this.prisma.communicationOutbox.findMany({
      where: quarantineEligible(this.staleThreshold(now)),
      select: { id: true },
      orderBy: { id: 'asc' },
      take: MailOutboundService.BATCH_SIZE,
    });
    for (const row of quarantinable) {
      if (await this.quarantine(row.id, now)) summary.failed += 1;
    }
    const candidates = await this.prisma.communicationOutbox.findMany({
      where: this.eligibleForClaim(now),
      select: { id: true },
      orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
      take: MailOutboundService.BATCH_SIZE,
    });
    summary.candidates = candidates.length;

    for (const candidate of candidates) {
      const outcome = await this.processOne(candidate.id);
      if (outcome === 'sent') summary.sent += 1;
      else if (outcome === 'deferred') summary.deferred += 1;
      else if (outcome === 'cancelled') summary.cancelled += 1;
      else if (outcome === 'failed') summary.failed += 1;
      else if (outcome === 'not_claimed') summary.notClaimed += 1;
      else if (outcome === 'conflict') summary.conflicts += 1;
      else if (outcome === 'ownership_lost_after_send') summary.ownershipLostAfterSend += 1;
    }
    return summary;
  }

  /** Revalidates the selected recipient and current workflow before dispatch. */
  async processOne(outboxId: string): Promise<OutboxProcessingOutcome> {
    const now = this.clock.now();
    if (await this.quarantine(outboxId, now)) return 'failed';
    const leaseToken = await this.claim(outboxId, now);
    if (!leaseToken) return 'not_claimed';

    try {
      const row = await this.loadContext(outboxId);
      const eligibility = await this.evaluateEligibility(row, now);
      if (eligibility.kind !== 'eligible') {
        return await this.resolveNonEligible(outboxId, row, eligibility, leaseToken);
      }

      const currentRecipient = eligibility.recipient;

      const materialized = await this.materialize(
        row,
        eligibility.mailConfiguration,
        currentRecipient,
        now,
        leaseToken,
      );

      // Recheck the persisted approval and workflow after message materialization.
      const freshRow = await this.loadContext(outboxId);
      const final = await this.evaluateEligibility(freshRow, this.clock.now());
      if (final.kind !== 'eligible') {
        return await this.resolveNonEligible(outboxId, freshRow, final, leaseToken);
      }
      if (final.recipient !== currentRecipient || final.mailConfiguration.id !== materialized.mailConfiguration.id) {
        return 'conflict';
      }

      return await dispatchSmtp(
        () => this.markAttempt(outboxId, leaseToken, {
          messageId: materialized.messageIdHeader,
          mailConfigurationId: materialized.mailConfiguration.id,
          recipient: currentRecipient,
          authorizedBy: freshRow.manualApprovedBy,
        }, freshRow),
        () => this.transport.send(
          {
            messageId: materialized.messageIdHeader,
            fromAddress: materialized.mailConfiguration.fromAddress,
            fromName: materialized.mailConfiguration.fromName,
            toAddress: currentRecipient,
            subject: row.subject,
            text: row.body,
            headers: { 'X-Renewal-Case-Id': row.renewalCaseId },
          },
          materialized.mailConfiguration,
        ),
        (attemptId, result) => result.accepted
          ? this.recordSuccess(outboxId, materialized.mailConfiguration.id, leaseToken, attemptId, result.acceptance, freshRow)
          : this.recordFailure(outboxId, materialized.mailConfiguration.id, result.error, leaseToken, attemptId),
      );
    } catch (error) {
      if (error instanceof OwnershipLostError) return 'conflict';
      throw error;
    }
  }

  private staleThreshold(now: Date): Date {
    return new Date(now.getTime() - STALE_PROCESSING_LEASE_MS);
  }

  private eligibleForClaim(now: Date): Prisma.CommunicationOutboxWhereInput {
    return {
      scheduledAt: { lte: now },
      ...replayEligible(now),
    };
  }

  private async quarantine(id: string, now: Date): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.communicationOutbox.updateMany({
        where: { id, ...quarantineEligible(this.staleThreshold(now)) },
        data: { status: CommunicationOutboxStatus.FAILED, smtpRetrySafe: false, smtpUncertain: true },
      });
      if (changed.count !== 1) return false;
      await this.audit.record({
        actorType: ActorType.SYSTEM,
        eventKey: 'mail.send.quarantined',
        subjectType: 'CommunicationOutbox',
        subjectId: id,
        metadata: { reason: UNCERTAIN_SMTP },
      }, tx);
      return true;
    });
  }

  private async claim(id: string, now: Date): Promise<Date | null> {
    const result = await this.prisma.communicationOutbox.updateMany({
      where: { id, ...this.eligibleForClaim(now) },
      data: { status: CommunicationOutboxStatus.PROCESSING, lastAttemptAt: now },
    });
    if (result.count !== 1) return null;
    const persisted = await this.prisma.communicationOutbox.findUniqueOrThrow({
      where: { id },
      select: { lastAttemptAt: true },
    });
    if (!persisted.lastAttemptAt) {
      throw new Error(`Internal consistency error: claim() succeeded for outbox ${id} but lastAttemptAt is null.`);
    }
    return persisted.lastAttemptAt;
  }

  private async loadContext(outboxId: string): Promise<OutboxContext> {
    return this.prisma.communicationOutbox.findUniqueOrThrow({
      where: { id: outboxId },
      include: outboxContextInclude,
    });
  }

  /**
   * Mailbox/thread pinning: a RenewalCase has exactly one canonical CommunicationThread (Slice A).
   * Once that thread exists, its mailConfigurationId IS the mailbox identity for every outbound
   * message in that case — including a retry of an already-materialized message, AND a later,
   * different reminder milestone's first message for the SAME case. Only when no thread exists yet
   * (this row is the first message ever for its case) does fresh BillingEntity/GLOBAL resolution
   * apply; that resolution is what the thread gets pinned to once created.
   */
  private async resolveMailConfigurationForRow(row: OutboxContext): Promise<MailConfigurationResolution> {
    const thread = await this.prisma.communicationThread.findUnique({
      where: { renewalCaseId: row.renewalCaseId },
    });
    if (thread) {
      const pinned = await this.prisma.mailConfiguration.findUnique({
        where: { id: thread.mailConfigurationId },
      });
      return this.mailConfigResolver.resolvePinned(pinned);
    }
    return this.mailConfigResolver.resolveForOutbound(row.customer.billingEntityId);
  }

  private async evaluateEligibility(row: OutboxContext, now: Date): Promise<EligibilityResult> {
    if (row.audience === ReminderAudience.CUSTOMER &&
        (!row.manualApprovedBy || row.auditEvent.actorId !== row.manualApprovedBy ||
          row.auditEvent.eventKey !== (row.resendOfId ? 'renewal.reminder.resend_authorized' : 'renewal.reminder.human_send') ||
          !(await this.prisma.user.findFirst({
            where: { id: row.manualApprovedBy, active: true, roles: { some: { role: { code: 'ADMIN' } } } },
            select: { id: true },
          })))) {
      return { kind: 'cancel', reason: 'human_approval_required' };
    }
    const configResolution = await this.resolveMailConfigurationForRow(row);
    if (!configResolution.usable) {
      return { kind: 'defer', reason: `mail_configuration_unusable:${configResolution.reason}` };
    }
    const mailConfiguration = configResolution.config;

    if (row.audience === ReminderAudience.INTERNAL) {
      const holdPolicy = aggregateEffectiveHolds(row.renewalCase.holds, now);
      const suppressed =
        holdPolicy.stopInternalNotifications && (row.notificationRule?.suppressOnWorkflowHold ?? true);
      if (suppressed) return { kind: 'defer', reason: 'internal_notification_hold' };
      return {
        kind: 'eligible',
        mailConfiguration,
        recipient: row.recipient,
      };
    }

    if (row.customer.status !== CustomerStatus.ACTIVE) {
      return { kind: 'cancel', reason: 'customer_inactive' };
    }
    if (row.subscription.status !== SubscriptionStatus.ACTIVE) {
      return { kind: 'cancel', reason: 'subscription_inactive' };
    }
    const eligible = row.purpose === 'CLARIFICATION'
      ? row.renewalCase.status === 'HUMAN_REVIEW' && row.renewalCase.clarificationPending &&
        row.caseRevision !== null && row.renewalCase.communicationRevision === row.caseRevision
      : isReminderEligible(row.renewalCase.status) && !row.renewalCase.clarificationPending &&
        (row.purpose !== 'REMINDER' || row.caseRevision === null ||
          row.renewalCase.communicationRevision === row.caseRevision);
    if (!eligible) {
      return { kind: 'cancel', reason: `case_not_reminder_eligible:${row.renewalCase.status}` };
    }
    if (row.resendOfId && await hasRecordedSmtpAcceptance(this.prisma, 'CommunicationOutbox', row.resendOfId)) {
      return { kind: 'cancel', reason: 'previous_attempt_accepted_by_smtp' };
    }

    // P1 sends pin the selected contact identity. Older P0 rows retain address-only provenance.
    if (row.purpose) {
      const selected = row.recipientContactId
        ? await this.prisma.customerContact.findFirst({
          where: { id: row.recipientContactId, customerId: row.customerId, email: row.recipient, active: true },
          select: { id: true },
        })
        : (await this.emailResolution.resolvePrimaryRecipient(row.customerId))?.email === row.recipient;
      return selected
        ? { kind: 'eligible', mailConfiguration, recipient: row.recipient }
        : { kind: 'cancel', reason: 'selected_recipient_no_longer_registered' };
    }

    // Recipient identity boundary: before any SMTP attempt (attempts === 0), the authoritative
    // recipient may still change and is rebound. Once an attempt has occurred, the message's
    // addressed identity is pinned — a changed or now-missing recipient after that point is a
    // business decision (cancel + audit), never a silent retry-to-old or mutate-to-new.
    const contact = await this.prisma.customerContact.findFirst({
      where: { customerId: row.customerId, email: row.recipient, active: true },
      select: { id: true },
    });
    const channel = contact ? null : await this.prisma.customerEmailAddress.findFirst({
      where: {
        customerId: row.customerId,
        email: row.recipient,
        active: true,
        OR: [{ contactId: null }, { contact: { active: true } }],
      },
      select: { id: true },
    });
    const legacy = contact || channel ? null : await this.emailResolution.resolvePrimaryRecipient(row.customerId);
    if (!contact && !channel &&
        (legacy?.source !== 'LEGACY_SCALAR_FALLBACK' || legacy.email !== row.recipient)) {
      return { kind: 'cancel', reason: 'selected_recipient_no_longer_registered' };
    }

    return {
      kind: 'eligible',
      mailConfiguration,
      recipient: row.recipient,
    };
  }

  private async resolveNonEligible(
    outboxId: string,
    row: OutboxContext,
    result: Extract<EligibilityResult, { kind: 'defer' | 'cancel' }>,
    expectedLeaseTimestamp: Date,
  ): Promise<OutboxProcessingOutcome> {
    if (result.kind === 'defer') {
      const ok = await this.deferToQueued(outboxId, result.reason, expectedLeaseTimestamp);
      return ok ? 'deferred' : 'conflict';
    }
    const ok = await this.cancel(outboxId, result.reason, row, expectedLeaseTimestamp, result.metadata);
    return ok ? 'cancelled' : 'conflict';
  }

  /** A temporary condition (hold, unusable mail config, missing recipient pre-attempt) is never a
   * permanent cancellation and never consumes a retry attempt: the row returns to QUEUED for later
   * reconsideration. `reason` is persisted to lastError as a sanitized operational note — never an
   * SMTP failure — so operators can see why without needing a new audit event on every polling
   * cycle the condition persists across. Ownership-guarded: returns false (no write took effect)
   * if this worker's lease token no longer matches current DB state. */
  private async deferToQueued(outboxId: string, reason: string, expectedLeaseTimestamp: Date): Promise<boolean> {
    const result = await this.prisma.communicationOutbox.updateMany({
      where: { id: outboxId, status: CommunicationOutboxStatus.PROCESSING, lastAttemptAt: expectedLeaseTimestamp },
      data: {
        status: CommunicationOutboxStatus.QUEUED,
        lastError: reason,
        nextAttemptAt: new Date(this.clock.now().getTime() + DEFER_RETRY_DELAY_MS),
      },
    });
    return result.count === 1;
  }

  /** Permanent business ineligibility, or an identity-pin violation discovered after an attempt
   * has already been made. Not an SMTP failure. Ownership-guarded like deferToQueued(). */
  private async cancel(
    outboxId: string,
    reason: string,
    row: OutboxContext,
    expectedLeaseTimestamp: Date,
    extraMetadata?: Record<string, unknown>,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.communicationOutbox.updateMany({
        where: { id: outboxId, status: CommunicationOutboxStatus.PROCESSING, lastAttemptAt: expectedLeaseTimestamp },
        data: { status: CommunicationOutboxStatus.CANCELLED, lastError: reason },
      });
      if (result.count !== 1) return false;
      await this.audit.record(
        {
          actorType: ActorType.SYSTEM,
          eventKey: 'mail.outbox.cancelled',
          subjectType: 'CommunicationOutbox',
          subjectId: outboxId,
          metadata: { reason, renewalCaseId: row.renewalCaseId, audience: row.audience, ...extraMetadata },
        },
        tx,
      );
      return true;
    });
  }

  /** Resolves/creates the thread and materializes the EmailMessage exactly once, before the
   * external SMTP call; on retry, reuses the same EmailMessage/Message-ID/MailConfiguration
   * verbatim (all pinned once materialized — see resolveMailConfigurationForRow() for how the
   * caller already guarantees `mailConfiguration` here is the pinned one, never a fresh
   * re-resolution). The outbox-linking write (setting emailMessageId/messageIdHeader) is
   * ownership-guarded like every other PROCESSING-state mutation; if the guard fails, the whole
   * transaction — including the just-created EmailMessage/thread — rolls back atomically, so no
   * orphaned EmailMessage is ever left behind, and the caller sees an OwnershipLostError. */
  private async materialize(
    row: OutboxContext,
    mailConfiguration: MailConfiguration,
    recipient: string,
    now: Date,
    expectedLeaseTimestamp: Date,
  ): Promise<{ mailConfiguration: MailConfiguration; messageIdHeader: string }> {
    if (row.emailMessageId) {
      const existing = await this.prisma.emailMessage.findUniqueOrThrow({
        where: { id: row.emailMessageId },
      });
      if (row.messageIdHeader && existing.externalMessageId && row.messageIdHeader !== existing.externalMessageId) {
        throw new Error(
          `Message-ID data-integrity violation for outbox ${row.id}: ` +
            `outbox.messageIdHeader (${row.messageIdHeader}) disagrees with ` +
            `emailMessage.externalMessageId (${existing.externalMessageId}).`,
        );
      }
      const messageIdHeader =
        row.messageIdHeader ?? existing.externalMessageId ?? generateStableMessageId(mailConfiguration.fromAddress);
      return { mailConfiguration, messageIdHeader };
    }

    const messageIdHeader = generateStableMessageId(mailConfiguration.fromAddress);
    await this.prisma.$transaction(async (tx) => {
      const thread = await this.threadResolution.resolveOrCreate(tx, {
        renewalCaseId: row.renewalCaseId,
        customerId: row.customerId,
        mailConfigurationId: mailConfiguration.id,
        subject: row.subject,
        occurredAt: now,
      });
      const emailMessage = await tx.emailMessage.create({
        data: {
          threadId: thread.id,
          customerId: row.customerId,
          renewalCaseId: row.renewalCaseId,
          direction: MessageDirection.OUTBOUND,
          channel: MessageChannel.EMAIL,
          subject: row.subject,
          fromAddress: mailConfiguration.fromAddress,
          toAddressesJson: [recipient],
          bodyText: row.body,
          occurredAt: now,
          mailConfigurationId: mailConfiguration.id,
          externalMessageId: messageIdHeader,
        },
      });
      const linked = await tx.communicationOutbox.updateMany({
        where: { id: row.id, status: CommunicationOutboxStatus.PROCESSING, lastAttemptAt: expectedLeaseTimestamp },
        data: { emailMessageId: emailMessage.id, messageIdHeader },
      });
      if (linked.count !== 1) {
        throw new OwnershipLostError();
      }
      await this.audit.record(
        {
          actorType: ActorType.SYSTEM,
          eventKey: 'mail.message.materialized',
          subjectType: 'EmailMessage',
          subjectId: emailMessage.id,
          metadata: { outboxId: row.id, renewalCaseId: row.renewalCaseId, threadId: thread.id },
        },
        tx,
      );
    });
    return { mailConfiguration, messageIdHeader };
  }

  /** Marks the actual SMTP attempt (attempts must reflect real SMTP attempts only, never
   * eligibility checks) — increments `attempts` ONLY, deliberately never touching
   * `lastAttemptAt`: rewriting the lease token here would destroy its usefulness as an ownership
   * token for the rest of this attempt (see the class-level LEASE OWNERSHIP doc comment). Guarded
   * on this worker's lease token; returns false (and must not be followed by an SMTP call) if
   * ownership was already lost. */
  private async markAttempt(
    outboxId: string,
    lease: Date,
    evidence: { messageId: string; mailConfigurationId: string; recipient: string; authorizedBy: string | null },
    row: OutboxContext,
  ): Promise<string | null> {
    const attemptId = randomUUID();
    return this.prisma.$transaction(async (tx) => {
      // Serialize a manually authorized resend with any late SMTP acceptance for the
      // ORIGINAL message. recordSuccess() updates that original outbox and writes its
      // acceptance evidence in one transaction; locking its row here makes evidence
      // already committed before the attempt boundary impossible to overlook.
      // A subsequent acceptance after the resend attempt starts remains the
      // documented duplicate-delivery risk explicitly acknowledged by ADMIN.
      if (row.resendOfId) {
        await tx.$queryRaw`SELECT id FROM communication_outbox WHERE id = ${row.resendOfId} FOR UPDATE`;
        if (await hasRecordedSmtpAcceptance(tx, 'CommunicationOutbox', row.resendOfId)) {
          const cancelled = await tx.communicationOutbox.updateMany({
            where: { id: outboxId, status: CommunicationOutboxStatus.PROCESSING, lastAttemptAt: lease },
            data: { status: CommunicationOutboxStatus.CANCELLED, lastError: 'original_accepted_before_resend_attempt' },
          });
          if (cancelled.count === 1) {
            await this.audit.record({
              actorType: ActorType.SYSTEM,
              eventKey: 'mail.outbox.cancelled',
              subjectType: 'CommunicationOutbox',
              subjectId: outboxId,
              metadata: { reason: 'original_accepted_before_resend_attempt', originalOutboxId: row.resendOfId },
            }, tx);
          }
          return null;
        }
      }
      const changed = await tx.communicationOutbox.updateMany({
        where: {
          id: outboxId, status: CommunicationOutboxStatus.PROCESSING, lastAttemptAt: lease,
          ...(row.purpose === 'CLARIFICATION' ? {
            renewalCase: { status: 'HUMAN_REVIEW', clarificationPending: true, communicationRevision: row.caseRevision ?? -1 },
          } : row.purpose === 'REMINDER' && row.caseRevision !== null ? {
            renewalCase: {
              status: { in: ['UPCOMING', 'REMINDER_CYCLE', 'AWAITING_CUSTOMER'] },
              clarificationPending: false,
              communicationRevision: row.caseRevision,
            },
          } : {}),
        },
        data: { attempts: { increment: 1 }, smtpRetrySafe: false },
      });
      if (changed.count !== 1) return null;
      await this.audit.record({
        actorType: ActorType.SYSTEM,
        eventKey: 'mail.send.attempt_started',
        subjectType: 'CommunicationOutbox',
        subjectId: outboxId,
        metadata: { attemptId, ...evidence, resendOfId: row.resendOfId ?? null },
      }, tx);
      return attemptId;
    });
  }

  /** Records late acceptance without updating a quarantined outbox row. */
  private async recordSuccess(
    outboxId: string,
    mailConfigurationId: string,
    expectedLeaseTimestamp: Date,
    attemptId: string,
    acceptance: MailAcceptance,
    row: OutboxContext,
  ): Promise<boolean> {
    const guarded = await this.prisma.$transaction(async (tx) => {
      // Lock the original row even after a stale lease was quarantined.
      // A conditional UPDATE can match zero rows, which must not permit
      // a concurrent manual resend to miss acceptance evidence recorded
      // by this transaction.
      await tx.$queryRaw`SELECT id FROM communication_outbox WHERE id = ${outboxId} FOR UPDATE`;
      const result = await tx.communicationOutbox.updateMany({
        where: { id: outboxId, status: CommunicationOutboxStatus.PROCESSING, lastAttemptAt: expectedLeaseTimestamp },
        data: { status: CommunicationOutboxStatus.DELIVERED, smtpRetrySafe: false, lastError: null, nextAttemptAt: null },
      });
      await this.audit.record(
        {
          actorType: ActorType.SYSTEM,
          eventKey: 'mail.send.succeeded',
          subjectType: 'CommunicationOutbox',
          subjectId: outboxId,
          metadata: { attemptId, acceptance: { ...acceptance }, applied: result.count === 1 },
        },
        tx,
      );
      if (result.count === 1 && acceptance.source === 'smtp' && row.purpose === 'CLARIFICATION' && row.caseRevision !== null) {
        const transitioned = await tx.renewalCase.updateMany({
          where: {
            id: row.renewalCaseId, status: 'HUMAN_REVIEW',
            clarificationPending: true, communicationRevision: row.caseRevision,
          },
          data: { status: 'AWAITING_CUSTOMER', clarificationPending: false, communicationRevision: { increment: 1 } },
        });
        if (transitioned.count === 1) {
          await this.audit.record({
            actorType: ActorType.SYSTEM, eventKey: 'renewal.clarification.accepted_by_smtp',
            subjectType: 'RenewalCase', subjectId: row.renewalCaseId,
            metadata: { outboxId, attemptId, caseRevision: row.caseRevision },
          }, tx);
        }
      }
      if (result.count === 1 && acceptance.source === 'smtp' && row.purpose === 'REMINDER' && row.caseRevision !== null) {
        const transitioned = await tx.renewalCase.updateMany({
          where: { id: row.renewalCaseId, status: { in: ['UPCOMING', 'REMINDER_CYCLE'] }, clarificationPending: false, communicationRevision: row.caseRevision },
          data: { status: 'AWAITING_CUSTOMER' },
        });
        if (transitioned.count === 1) await this.audit.record({ actorType: ActorType.SYSTEM, eventKey: 'renewal.reminder.accepted_by_smtp', subjectType: 'RenewalCase', subjectId: row.renewalCaseId, metadata: { outboxId, attemptId, caseRevision: row.caseRevision } }, tx);
      }
      return result.count === 1;
    });
    if (guarded) {
      await this.health.record(mailConfigurationId, HealthStatus.HEALTHY, 'SMTP send succeeded.');
    } else {
      await this.recordOwnershipLostAfterTransmission(outboxId, mailConfigurationId);
    }
    return guarded;
  }

  /** Only evidence of nonacceptance may reopen an attempt for a bounded retry. */
  private async recordFailure(
    outboxId: string,
    mailConfigurationId: string,
    error: unknown,
    expectedLeaseTimestamp: Date,
    attemptId: string,
  ): Promise<boolean> {
    const evidence = smtpFailure(error);
    const sanitized = evidence.outcome === 'uncertain' ? UNCERTAIN_SMTP : 'SMTP did not accept this attempt.';
    const classification = classifySmtpError(error);
    const current = await this.prisma.communicationOutbox.findUniqueOrThrow({
      where: { id: outboxId },
      select: { attempts: true },
    });
    const boundExhausted = current.attempts >= MailOutboundService.MAX_SEND_ATTEMPTS;
    const terminal = evidence.outcome === 'uncertain' || classification.terminal || boundExhausted;
    const nextStatus = terminal ? CommunicationOutboxStatus.FAILED : CommunicationOutboxStatus.QUEUED;
    const guarded = await this.prisma.$transaction(async (tx) => {
      const result = await tx.communicationOutbox.updateMany({
        where: { id: outboxId, status: CommunicationOutboxStatus.PROCESSING, lastAttemptAt: expectedLeaseTimestamp },
        data: {
          status: nextStatus,
          smtpRetrySafe: !terminal,
          smtpUncertain: evidence.outcome === 'uncertain',
          lastError: sanitized,
          nextAttemptAt: terminal ? null : new Date(
            this.clock.now().getTime() +
              SMTP_RETRY_BACKOFF_MS[Math.min(current.attempts - 1, SMTP_RETRY_BACKOFF_MS.length - 1)]!,
          ),
        },
      });
      await this.audit.record({
        actorType: ActorType.SYSTEM,
        eventKey: terminal ? 'mail.send.failed' : 'mail.send.retryable_nonacceptance',
        subjectType: 'CommunicationOutbox',
        subjectId: outboxId,
        metadata: { attemptId, evidence, classification, applied: result.count === 1 },
      }, tx);
      return result.count === 1;
    });
    if (guarded) {
      if (classification.healthImpact === 'infrastructure') {
        await this.health.record(
          mailConfigurationId,
          terminal ? HealthStatus.UNAVAILABLE : HealthStatus.DEGRADED,
          sanitized,
        );
      }
    } else {
      await this.recordOwnershipLostAfterTransmission(outboxId, mailConfigurationId);
    }
    return guarded;
  }

  private async recordOwnershipLostAfterTransmission(
    outboxId: string,
    mailConfigurationId: string,
  ): Promise<void> {
    await this.audit.record({
      actorType: ActorType.SYSTEM,
      eventKey: 'mail.send.ownership_lost_after_transmission',
      subjectType: 'CommunicationOutbox',
      subjectId: outboxId,
      metadata: {
        mailConfigurationId,
        note: 'SMTP evidence arrived after the outbox stopped accepting writes for this lease.',
      },
    });
  }
}
