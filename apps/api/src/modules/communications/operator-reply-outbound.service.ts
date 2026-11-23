import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../../audit/audit.service';
import { PrismaService } from '../../database/prisma.service';
import { ClockService } from '../../time/clock.service';
import type { MailConfiguration, Prisma } from '../../generated/prisma/client';
import { ActorType, CommunicationOutboxStatus, HealthStatus } from '../../generated/prisma/enums';
import { CustomerEmailResolutionService } from '../customers/customer-email-resolution.service';
import { MailConfigurationResolverService } from '../mail/mail-configuration-resolver.service';
import { MailHealthService } from '../mail/mail-health.service';
import { hasRecordedSmtpAcceptance } from '../mail/outbound-resend-policy';
import { MAIL_TRANSPORT, type MailTransport } from '../mail/mail-transport';
import { STALE_PROCESSING_LEASE_MS } from '../mail/mail-timing.constants';
import { classifySmtpError } from '../mail/smtp-error-classification';
import { dispatchSmtp, quarantineEligible, replayEligible, smtpFailure, UNCERTAIN_SMTP, type MailAcceptance } from '../mail/smtp-attempt-policy';
import { COMMUNICATION_AUDIT_EVENT } from './communications-events.constants';
import { OPERATOR_REPLY_BATCH_SIZE } from './operator-reply-queue.constants';
import { DEFER_RETRY_DELAY_MS, SMTP_RETRY_BACKOFF_MS } from './operator-reply-timing.constants';

/** Internal signal only — never escapes this class. Mirrors MailOutboundService's own use of the
 * same pattern (see that file's doc comment for the full rationale): thrown inside a guarded
 * updateMany()'s transaction to abort/roll back when the ownership CAS predicate no longer
 * matches, and caught immediately by the method that threw it. */
class OwnershipLostError extends Error {}

const outboxContextInclude = {
  thread: true,
  emailMessage: true,
} as const;

type OutboxContext = Prisma.OperatorReplyOutboxGetPayload<{ include: typeof outboxContextInclude }>;

type EligibilityResult =
  | { kind: 'eligible'; mailConfiguration: MailConfiguration; recipient: string; recipientChanged: boolean; oldRecipient: string }
  | { kind: 'defer'; reason: string }
  | { kind: 'cancel'; reason: string };

export type ReplyProcessingOutcome =
  | 'sent'
  | 'deferred'
  | 'cancelled'
  | 'failed'
  | 'not_claimed'
  | 'conflict'
  | 'ownership_lost_after_send';

export interface ReplyBatchSummary {
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
 * Slice E §9/§13/§14/§16 — the ONE place an operator reply is actually transmitted over SMTP. A
 * deliberately smaller, single-purpose analogue of MailOutboundService's claim/lease/CAS
 * architecture (same identity-pinning discipline: pre-attempt = mutable/reboundable, post-attempt =
 * pinned — see that class's own doc comment for the full rationale, not duplicated here) — NOT a
 * copy of that class, and it never touches CommunicationOutbox/MailOutboundService's table or code
 * at all (see the schema.prisma doc comment on OperatorReplyOutbox for why they are intentionally
 * separate). Unlike MailOutboundService, there is no reminder-cycle eligibility (no Customer/
 * Subscription ACTIVE checks, no isReminderEligible(), no workflow-hold suppression) — a human
 * operator's deliberate reply is not subject to those business rules; the only things checked here
 * are (1) the thread's pinned mailbox is currently usable and (2) the customer still has an
 * authoritative recipient. The EmailMessage is already materialized (by OperatorReplyService,
 * synchronously, before this row exists) — this class never creates one, only sends.
 *
 * Phase 3.1 §D/§Q correction — there is no global env-level enablement gate here any more.
 * MAIL_SEND_ENABLED is deprecated/parsed-only (see environment.ts) and is never read by this
 * class. Each row's mailbox is resolved fresh via resolvePinned() in evaluateEligibility(), which
 * requires that mailbox's own DB-managed `outboundSendEnabled` before treating it as eligible.
 */
@Injectable()
export class OperatorReplyOutboundService {
  private static readonly MAX_SEND_ATTEMPTS = 5;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clock: ClockService,
    private readonly mailConfigResolver: MailConfigurationResolverService,
    private readonly emailResolution: CustomerEmailResolutionService,
    private readonly health: MailHealthService,
    @Inject(MAIL_TRANSPORT) private readonly transport: MailTransport,
  ) {}

  async processBatch(): Promise<ReplyBatchSummary> {
    const summary: ReplyBatchSummary = {
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
    const quarantinable = await this.prisma.operatorReplyOutbox.findMany({
      where: quarantineEligible(this.staleThreshold(now)),
      select: { id: true },
      orderBy: { id: 'asc' },
      take: OPERATOR_REPLY_BATCH_SIZE,
    });
    for (const row of quarantinable) {
      if (await this.quarantine(row.id, now)) summary.failed += 1;
    }
    const candidates = await this.prisma.operatorReplyOutbox.findMany({
      where: this.eligibleForClaim(now),
      select: { id: true },
      orderBy: [{ queuedAt: 'asc' }, { id: 'asc' }],
      take: OPERATOR_REPLY_BATCH_SIZE,
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

  async processOne(outboxId: string): Promise<ReplyProcessingOutcome> {
    const now = this.clock.now();
    if (await this.quarantine(outboxId, now)) return 'failed';
    const leaseToken = await this.claim(outboxId, now);
    if (!leaseToken) return 'not_claimed';

    try {
      const row = await this.loadContext(outboxId);
      const eligibility = await this.evaluateEligibility(row);
      if (eligibility.kind !== 'eligible') {
        return await this.resolveNonEligible(outboxId, eligibility, leaseToken);
      }

      const currentRecipient = eligibility.recipient;
      if (eligibility.recipientChanged) {
        const rebound = await this.rebindRecipient(row, eligibility.recipient, leaseToken);
        if (rebound === 'conflict') return 'conflict';
      }

      return await dispatchSmtp(
        () => this.markAttempt(outboxId, leaseToken, {
          messageId: row.emailMessage.externalMessageId ?? row.emailMessage.id,
          mailConfigurationId: eligibility.mailConfiguration.id,
          recipient: currentRecipient,
          authorizedBy: row.actorId,
        }, row),
        () => this.transport.send(
          {
            messageId: row.emailMessage.externalMessageId ?? row.emailMessage.id,
            fromAddress: eligibility.mailConfiguration.fromAddress,
            fromName: eligibility.mailConfiguration.fromName,
            toAddress: currentRecipient,
            subject: row.emailMessage.subject,
            text: row.emailMessage.bodyText,
            headers: {
              ...(row.emailMessage.inReplyTo ? { 'In-Reply-To': row.emailMessage.inReplyTo } : {}),
              ...(row.emailMessage.references ? { References: row.emailMessage.references } : {}),
              // §11 — retained only when the thread is actually linked to a RenewalCase.
              ...(row.emailMessage.renewalCaseId ? { 'X-Renewal-Case-Id': row.emailMessage.renewalCaseId } : {}),
            },
          },
          eligibility.mailConfiguration,
        ),
        (attemptId, result) => result.accepted
          ? this.recordSuccess(outboxId, eligibility.mailConfiguration.id, leaseToken, attemptId, result.acceptance)
          : this.recordFailure(outboxId, eligibility.mailConfiguration.id, result.error, leaseToken, attemptId),
      );
    } catch (error) {
      if (error instanceof OwnershipLostError) return 'conflict';
      throw error;
    }
  }

  private staleThreshold(now: Date): Date {
    return new Date(now.getTime() - STALE_PROCESSING_LEASE_MS);
  }

  private eligibleForClaim(now: Date): Prisma.OperatorReplyOutboxWhereInput {
    return replayEligible(now);
  }

  private async quarantine(id: string, now: Date): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.operatorReplyOutbox.updateMany({
        where: { id, ...quarantineEligible(this.staleThreshold(now)) },
        data: { status: CommunicationOutboxStatus.FAILED, smtpRetrySafe: false, smtpUncertain: true },
      });
      if (changed.count !== 1) return false;
      await this.audit.record({
        actorType: ActorType.SYSTEM,
        eventKey: 'mail.send.quarantined',
        subjectType: 'OperatorReplyOutbox',
        subjectId: id,
        metadata: { reason: UNCERTAIN_SMTP },
      }, tx);
      return true;
    });
  }

  private async claim(id: string, now: Date): Promise<Date | null> {
    const result = await this.prisma.operatorReplyOutbox.updateMany({
      where: { id, ...this.eligibleForClaim(now) },
      data: { status: CommunicationOutboxStatus.PROCESSING, lastAttemptAt: now },
    });
    if (result.count !== 1) return null;
    const persisted = await this.prisma.operatorReplyOutbox.findUniqueOrThrow({
      where: { id },
      select: { lastAttemptAt: true },
    });
    if (!persisted.lastAttemptAt) {
      throw new Error(`Internal consistency error: claim() succeeded for reply outbox ${id} but lastAttemptAt is null.`);
    }
    return persisted.lastAttemptAt;
  }

  private async loadContext(outboxId: string): Promise<OutboxContext> {
    return this.prisma.operatorReplyOutbox.findUniqueOrThrow({ where: { id: outboxId }, include: outboxContextInclude });
  }

  private async evaluateEligibility(row: OutboxContext): Promise<EligibilityResult> {
    const actor = await this.prisma.user.findFirst({
      where: { id: row.actorId, active: true, roles: { some: { role: { code: 'ADMIN' } } } },
      select: { id: true },
    });
    if (!actor) return { kind: 'cancel', reason: 'human_approval_required' };
    // §9 — always the thread's own pinned mailbox; never re-resolved to a different one.
    const configResolution = this.mailConfigResolver.resolvePinned(
      await this.prisma.mailConfiguration.findUnique({ where: { id: row.mailConfigurationId } }),
      { checkCutover: false },
    );
    if (!configResolution.usable) {
      return { kind: 'defer', reason: `mail_configuration_unusable:${configResolution.reason}` };
    }

    const attempted = row.attempts > 0 || Boolean(row.resendOfId);
    if (row.resendOfId && await hasRecordedSmtpAcceptance(this.prisma, 'OperatorReplyOutbox', row.resendOfId)) {
      return { kind: 'cancel', reason: 'previous_attempt_accepted_by_smtp' };
    }
    if (!row.thread.customerId) {
      return attempted
        ? { kind: 'cancel', reason: 'no_customer_attributed' }
        : { kind: 'defer', reason: 'no_customer_attributed' };
    }
    const resolved = await this.emailResolution.resolvePrimaryRecipient(row.thread.customerId);

    if (!resolved) {
      return attempted
        ? { kind: 'cancel', reason: 'recipient_unavailable_after_attempt' }
        : { kind: 'defer', reason: 'no_current_recipient' };
    }

    if (resolved.email !== row.recipient) {
      if (!attempted) {
        return {
          kind: 'eligible',
          mailConfiguration: configResolution.config,
          recipient: resolved.email,
          recipientChanged: true,
          oldRecipient: row.recipient,
        };
      }
      return { kind: 'cancel', reason: 'recipient_changed_after_attempt' };
    }

    return {
      kind: 'eligible',
      mailConfiguration: configResolution.config,
      recipient: resolved.email,
      recipientChanged: false,
      oldRecipient: row.recipient,
    };
  }

  private async resolveNonEligible(
    outboxId: string,
    result: Extract<EligibilityResult, { kind: 'defer' | 'cancel' }>,
    expectedLeaseTimestamp: Date,
  ): Promise<ReplyProcessingOutcome> {
    if (result.kind === 'defer') {
      const ok = await this.deferToQueued(outboxId, result.reason, expectedLeaseTimestamp);
      return ok ? 'deferred' : 'conflict';
    }
    const ok = await this.cancel(outboxId, result.reason, expectedLeaseTimestamp);
    return ok ? 'cancelled' : 'conflict';
  }

  /** §2 (contract audit) — a temporary, non-SMTP defer (mailbox currently unusable, no current
   * recipient pre-attempt) never consumes an attempt, but still gets a modest fixed future
   * retry time (DEFER_RETRY_DELAY_MS) so the 15s scheduler does not reselect — and redo the exact
   * same eligibility check against — this row on every single tick while the underlying condition
   * persists. */
  private async deferToQueued(outboxId: string, reason: string, expectedLeaseTimestamp: Date): Promise<boolean> {
    const result = await this.prisma.operatorReplyOutbox.updateMany({
      where: { id: outboxId, status: CommunicationOutboxStatus.PROCESSING, lastAttemptAt: expectedLeaseTimestamp },
      data: {
        status: CommunicationOutboxStatus.QUEUED,
        lastError: reason,
        nextAttemptAt: new Date(this.clock.now().getTime() + DEFER_RETRY_DELAY_MS),
      },
    });
    return result.count === 1;
  }

  private async cancel(outboxId: string, reason: string, expectedLeaseTimestamp: Date): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.operatorReplyOutbox.updateMany({
        where: { id: outboxId, status: CommunicationOutboxStatus.PROCESSING, lastAttemptAt: expectedLeaseTimestamp },
        data: { status: CommunicationOutboxStatus.CANCELLED, lastError: reason },
      });
      if (result.count !== 1) return false;
      await this.audit.record(
        {
          actorType: ActorType.SYSTEM,
          eventKey: 'communication.reply.cancelled',
          subjectType: 'OperatorReplyOutbox',
          subjectId: outboxId,
          metadata: { reason },
        },
        tx,
      );
      return true;
    });
  }

  /** Rebinds a not-yet-attempted row to the current authoritative recipient — atomically across
   * OperatorReplyOutbox.recipient AND EmailMessage.toAddressesJson, mirroring
   * MailOutboundService.rebindRecipientAndMessage()'s exact safety discipline (never touches an
   * already-attempted row, never touches a row this worker no longer owns). */
  private async rebindRecipient(row: OutboxContext, newRecipient: string, expectedLeaseTimestamp: Date): Promise<'rebound' | 'conflict'> {
    try {
      await this.prisma.$transaction(async (tx) => {
        const guarded = await tx.operatorReplyOutbox.updateMany({
          where: { id: row.id, status: CommunicationOutboxStatus.PROCESSING, lastAttemptAt: expectedLeaseTimestamp, attempts: 0 },
          data: { recipient: newRecipient },
        });
        if (guarded.count !== 1) throw new OwnershipLostError();
        await tx.emailMessage.update({ where: { id: row.emailMessageId }, data: { toAddressesJson: [newRecipient] } });
        await this.audit.record(
          {
            actorType: ActorType.SYSTEM,
            eventKey: 'communication.reply.recipient_rebound',
            subjectType: 'OperatorReplyOutbox',
            subjectId: row.id,
            metadata: { oldRecipient: row.recipient, newRecipient },
          },
          tx,
        );
      });
      return 'rebound';
    } catch (error) {
      if (error instanceof OwnershipLostError) return 'conflict';
      throw error;
    }
  }

  private async markAttempt(
    outboxId: string,
    lease: Date,
    evidence: { messageId: string; mailConfigurationId: string; recipient: string; authorizedBy: string },
    row: OutboxContext,
  ): Promise<string | null> {
    const attemptId = randomUUID();
    return this.prisma.$transaction(async (tx) => {
      // Pair the original reply row lock with its acceptance evidence check. A late
      // original acceptance committed BEFORE this attempt cannot be overlooked;
      // a genuinely later acceptance remains the warned duplicate-delivery risk.
      if (row.resendOfId) {
        await tx.$queryRaw`SELECT id FROM operator_reply_outbox WHERE id = ${row.resendOfId} FOR UPDATE`;
        if (await hasRecordedSmtpAcceptance(tx, 'OperatorReplyOutbox', row.resendOfId)) {
          const cancelled = await tx.operatorReplyOutbox.updateMany({
            where: { id: outboxId, status: CommunicationOutboxStatus.PROCESSING, lastAttemptAt: lease },
            data: { status: CommunicationOutboxStatus.CANCELLED, lastError: 'original_accepted_before_resend_attempt' },
          });
          if (cancelled.count === 1) {
            await this.audit.record({
              actorType: ActorType.SYSTEM,
              eventKey: 'communication.reply.cancelled',
              subjectType: 'OperatorReplyOutbox',
              subjectId: outboxId,
              metadata: { reason: 'original_accepted_before_resend_attempt', originalOutboxId: row.resendOfId },
            }, tx);
          }
          return null;
        }
      }
      const changed = await tx.operatorReplyOutbox.updateMany({
        where: { id: outboxId, status: CommunicationOutboxStatus.PROCESSING, lastAttemptAt: lease },
        data: { attempts: { increment: 1 }, smtpRetrySafe: false },
      });
      if (changed.count !== 1) return null;
      await this.audit.record({
        actorType: ActorType.SYSTEM,
        eventKey: 'mail.send.attempt_started',
        subjectType: 'OperatorReplyOutbox',
        subjectId: outboxId,
        metadata: { attemptId, ...evidence },
      }, tx);
      return attemptId;
    });
  }

  private async recordSuccess(
    outboxId: string,
    mailConfigurationId: string,
    expectedLeaseTimestamp: Date,
    attemptId: string,
    acceptance: MailAcceptance,
  ): Promise<boolean> {
    const guarded = await this.prisma.$transaction(async (tx) => {
      // Synchronize late original SMTP acceptance with a resend's
      // markAttempt() lock, including after lease quarantine.
      await tx.$queryRaw`SELECT id FROM operator_reply_outbox WHERE id = ${outboxId} FOR UPDATE`;
      const result = await tx.operatorReplyOutbox.updateMany({
        where: { id: outboxId, status: CommunicationOutboxStatus.PROCESSING, lastAttemptAt: expectedLeaseTimestamp },
        // §3 (contract audit) — no stale operator-visible error survives a later successful send,
        // regardless of how many prior defers/failures this row went through.
        data: { status: CommunicationOutboxStatus.DELIVERED, smtpRetrySafe: false, lastError: null, nextAttemptAt: null },
      });
      await this.audit.record(
        { actorType: ActorType.SYSTEM, eventKey: 'communication.reply.delivered', subjectType: 'OperatorReplyOutbox', subjectId: outboxId, metadata: { attemptId, acceptance: { ...acceptance }, applied: result.count === 1 } },
        tx,
      );
      return result.count === 1;
    });
    if (guarded) {
      await this.health.record(mailConfigurationId, HealthStatus.HEALTHY, 'SMTP send succeeded.');
    } else {
      await this.recordOwnershipLostAfterTransmission(outboxId, mailConfigurationId);
    }
    return guarded;
  }

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
    const current = await this.prisma.operatorReplyOutbox.findUniqueOrThrow({ where: { id: outboxId }, select: { attempts: true } });
    const boundExhausted = current.attempts >= OperatorReplyOutboundService.MAX_SEND_ATTEMPTS;
    const terminal = evidence.outcome === 'uncertain' || classification.terminal || boundExhausted;
    const nextStatus = terminal ? CommunicationOutboxStatus.FAILED : CommunicationOutboxStatus.QUEUED;
    // §2 (contract audit) — real escalating backoff, keyed off the just-incremented attempts count
    // (markAttempt() already ran before the SMTP call this failure came from): attempt 1 -> index 0
    // (~1min), attempt 2 -> index 1 (~5min), attempt 3 -> index 2 (~15min), attempt 4 -> index 3
    // (~30min). A terminal outcome never sets a next attempt time — the row is never reselected
    // once FAILED. current.attempts is always >= 1 here (a failure can only follow a real SMTP
    // attempt, which only happens after markAttempt()), so index -1 never occurs.
    const nextAttemptAt = terminal
      ? null
      : new Date(
          this.clock.now().getTime() +
            SMTP_RETRY_BACKOFF_MS[Math.min(current.attempts - 1, SMTP_RETRY_BACKOFF_MS.length - 1)]!,
        );
    const guarded = await this.prisma.$transaction(async (tx) => {
      const result = await tx.operatorReplyOutbox.updateMany({
        where: { id: outboxId, status: CommunicationOutboxStatus.PROCESSING, lastAttemptAt: expectedLeaseTimestamp },
        data: {
          status: nextStatus,
          smtpRetrySafe: !terminal,
          smtpUncertain: evidence.outcome === 'uncertain',
          lastError: sanitized,
          nextAttemptAt,
        },
      });
      await this.audit.record({
        actorType: ActorType.SYSTEM,
        eventKey: terminal ? COMMUNICATION_AUDIT_EVENT.REPLY_SEND_FAILED : 'mail.send.retryable_nonacceptance',
        subjectType: 'OperatorReplyOutbox',
        subjectId: outboxId,
        metadata: { attemptId, evidence, classification, applied: result.count === 1 },
      }, tx);
      return result.count === 1;
    });
    if (guarded) {
      if (classification.healthImpact === 'infrastructure') {
        await this.health.record(mailConfigurationId, terminal ? HealthStatus.UNAVAILABLE : HealthStatus.DEGRADED, sanitized);
      }
    } else {
      await this.recordOwnershipLostAfterTransmission(outboxId, mailConfigurationId);
    }
    return guarded;
  }

  private async recordOwnershipLostAfterTransmission(outboxId: string, mailConfigurationId: string): Promise<void> {
    await this.audit.record({
      actorType: ActorType.SYSTEM,
      eventKey: 'communication.reply.ownership_lost_after_transmission',
      subjectType: 'OperatorReplyOutbox',
      subjectId: outboxId,
      metadata: {
        mailConfigurationId,
        note: 'SMTP evidence arrived after the outbox stopped accepting writes for this lease.',
      },
    });
  }
}
