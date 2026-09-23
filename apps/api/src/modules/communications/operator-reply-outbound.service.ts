import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../../audit/audit.service';
import { PrismaService } from '../../database/prisma.service';
import { ClockService } from '../../time/clock.service';
import type { MailConfiguration, Prisma } from '../../generated/prisma/client';
import { ActorType, CommunicationOutboxStatus, HealthStatus } from '../../generated/prisma/enums';
import { CustomerEmailResolutionService } from '../customers/customer-email-resolution.service';
import { MailConfigurationResolverService } from '../mail/mail-configuration-resolver.service';
import { MailHealthService } from '../mail/mail-health.service';
import { MAIL_TRANSPORT, type MailTransport } from '../mail/mail-transport';
import { STALE_PROCESSING_LEASE_MS } from '../mail/mail-timing.constants';
import { classifySmtpError } from '../mail/smtp-error-classification';
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
  | 'disabled'
  | 'conflict'
  | 'ownership_lost_after_send';

export interface ReplyBatchSummary {
  disabled: boolean;
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
 */
@Injectable()
export class OperatorReplyOutboundService {
  private static readonly MAX_SEND_ATTEMPTS = 5;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clock: ClockService,
    private readonly config: ConfigService,
    private readonly mailConfigResolver: MailConfigurationResolverService,
    private readonly emailResolution: CustomerEmailResolutionService,
    private readonly health: MailHealthService,
    @Inject(MAIL_TRANSPORT) private readonly transport: MailTransport,
  ) {}

  async processBatch(): Promise<ReplyBatchSummary> {
    const summary: ReplyBatchSummary = {
      disabled: false,
      candidates: 0,
      sent: 0,
      deferred: 0,
      cancelled: 0,
      failed: 0,
      notClaimed: 0,
      conflicts: 0,
      ownershipLostAfterSend: 0,
    };
    if (!this.sendingEnabled()) {
      summary.disabled = true;
      return summary;
    }

    const now = this.clock.now();
    const staleThreshold = this.staleThreshold(now);
    // §7 (contract audit) — deliberately NO `queuedAt >= cutover` filter here, unlike
    // MailOutboundService. That filter exists in Slice B to stop historical, pre-Slice-B
    // AUTOMATIC reminder rows (queued by a system with no real send capability yet) from suddenly
    // being sent once real SMTP activates — a one-time watermark for rows that predate this
    // feature entirely. OperatorReplyOutbox has no such history: every row is a deliberate human
    // send action created by this very feature, with no automatic regeneration mechanism if
    // skipped. Gating on a cutover watermark here would risk PERMANENTLY stranding a real human
    // reply queued between two values of MAIL_SEND_CUTOVER_AT if that env var is ever changed
    // after the row was created (queuedAt is immutable) — an unacceptable outcome for a one-of-a-
    // kind human message. MAIL_SEND_ENABLED (checked above) remains the correct safety gate: it is
    // a live toggle, not a watermark, so it can never strand a row — disabling it just leaves
    // QUEUED rows QUEUED until re-enabled (see sendingEnabled()'s own tests).
    // §2 (contract audit) — a QUEUED row is only a candidate once its own retry-backoff time has
    // arrived (nextAttemptAt IS NULL, meaning "eligible immediately" — a freshly-queued human
    // reply always is — OR nextAttemptAt <= now). See operator-reply-timing.constants.ts for the
    // exact schedule and setNextAttemptAt()'s doc comment for how it is set on every deferral.
    const candidates = await this.prisma.operatorReplyOutbox.findMany({
      where: {
        OR: [
          {
            status: CommunicationOutboxStatus.QUEUED,
            OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
          },
          { status: CommunicationOutboxStatus.PROCESSING, lastAttemptAt: { lt: staleThreshold } },
        ],
      },
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
    if (!this.sendingEnabled()) return 'disabled';

    const now = this.clock.now();
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

      const attemptMarked = await this.markAttempt(outboxId, leaseToken);
      if (!attemptMarked) return 'conflict'; // ownership lost before the SMTP call — safe.

      let sendError: { failed: true; error: unknown } | { failed: false } = { failed: false };
      try {
        await this.transport.send(
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
        );
      } catch (error) {
        sendError = { failed: true, error };
      }

      if (!sendError.failed) {
        const recorded = await this.recordSuccess(outboxId, eligibility.mailConfiguration.id, leaseToken);
        return recorded ? 'sent' : 'ownership_lost_after_send';
      }
      const recorded = await this.recordFailure(outboxId, eligibility.mailConfiguration.id, sendError.error, leaseToken);
      return recorded ? 'failed' : 'ownership_lost_after_send';
    } catch (error) {
      if (error instanceof OwnershipLostError) return 'conflict';
      throw error;
    }
  }

  private sendingEnabled(): boolean {
    return this.config.get<string>('MAIL_SEND_ENABLED') === 'true';
  }

  private staleThreshold(now: Date): Date {
    return new Date(now.getTime() - STALE_PROCESSING_LEASE_MS);
  }

  /** Same claim predicate/lease-token discipline as MailOutboundService.claim() — see that
   * method's doc comment for the exact rationale (not repeated here). Deliberately no cutover
   * gate — see processBatch()'s doc comment for why one would risk permanently stranding a human
   * reply. */
  private async claim(id: string, now: Date): Promise<Date | null> {
    const result = await this.prisma.operatorReplyOutbox.updateMany({
      where: {
        id,
        OR: [
          {
            status: CommunicationOutboxStatus.QUEUED,
            OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
          },
          { status: CommunicationOutboxStatus.PROCESSING, lastAttemptAt: { lt: this.staleThreshold(now) } },
        ],
      },
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
    // §9 — always the thread's own pinned mailbox; never re-resolved to a different one.
    const configResolution = this.mailConfigResolver.resolvePinned(
      await this.prisma.mailConfiguration.findUnique({ where: { id: row.mailConfigurationId } }),
      { checkCutover: false },
    );
    if (!configResolution.usable) {
      return { kind: 'defer', reason: `mail_configuration_unusable:${configResolution.reason}` };
    }

    const attempted = row.attempts > 0;
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
        nextAttemptAt: new Date(expectedLeaseTimestamp.getTime() + DEFER_RETRY_DELAY_MS),
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

  private async markAttempt(outboxId: string, expectedLeaseTimestamp: Date): Promise<boolean> {
    const result = await this.prisma.operatorReplyOutbox.updateMany({
      where: { id: outboxId, status: CommunicationOutboxStatus.PROCESSING, lastAttemptAt: expectedLeaseTimestamp },
      data: { attempts: { increment: 1 } },
    });
    return result.count === 1;
  }

  private async recordSuccess(outboxId: string, mailConfigurationId: string, expectedLeaseTimestamp: Date): Promise<boolean> {
    const guarded = await this.prisma.$transaction(async (tx) => {
      const result = await tx.operatorReplyOutbox.updateMany({
        where: { id: outboxId, status: CommunicationOutboxStatus.PROCESSING, lastAttemptAt: expectedLeaseTimestamp },
        // §3 (contract audit) — no stale operator-visible error survives a later successful send,
        // regardless of how many prior defers/failures this row went through.
        data: { status: CommunicationOutboxStatus.DELIVERED, lastError: null, nextAttemptAt: null },
      });
      if (result.count !== 1) return false;
      await this.audit.record(
        { actorType: ActorType.SYSTEM, eventKey: 'communication.reply.delivered', subjectType: 'OperatorReplyOutbox', subjectId: outboxId },
        tx,
      );
      return true;
    });
    if (guarded) {
      await this.health.record(mailConfigurationId, HealthStatus.HEALTHY, 'SMTP send succeeded.');
    } else {
      await this.recordOwnershipLostAfterTransmission(outboxId, mailConfigurationId);
    }
    return guarded;
  }

  private async recordFailure(outboxId: string, mailConfigurationId: string, error: unknown, expectedLeaseTimestamp: Date): Promise<boolean> {
    const sanitized = this.sanitizeError(error);
    const classification = classifySmtpError(error);
    const current = await this.prisma.operatorReplyOutbox.findUniqueOrThrow({ where: { id: outboxId }, select: { attempts: true } });
    const boundExhausted = current.attempts >= OperatorReplyOutboundService.MAX_SEND_ATTEMPTS;
    const terminal = classification.terminal || boundExhausted;
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
          expectedLeaseTimestamp.getTime() +
            SMTP_RETRY_BACKOFF_MS[Math.min(current.attempts - 1, SMTP_RETRY_BACKOFF_MS.length - 1)]!,
        );
    const guarded = await this.prisma.$transaction(async (tx) => {
      const result = await tx.operatorReplyOutbox.updateMany({
        where: { id: outboxId, status: CommunicationOutboxStatus.PROCESSING, lastAttemptAt: expectedLeaseTimestamp },
        data: { status: nextStatus, lastError: sanitized, nextAttemptAt },
      });
      if (result.count !== 1) return false;
      if (terminal) {
        await this.audit.record(
          {
            actorType: ActorType.SYSTEM,
            eventKey: COMMUNICATION_AUDIT_EVENT.REPLY_SEND_FAILED,
            subjectType: 'OperatorReplyOutbox',
            subjectId: outboxId,
            metadata: { error: sanitized, classification },
          },
          tx,
        );
      }
      return true;
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
        note:
          'SMTP was called (outcome not necessarily known here) but this worker had already lost row ' +
          "ownership to a newer claimant before it could persist the result; the newer owner's state " +
          'was preserved untouched — see MailOutboundService for the identical, previously-documented ' +
          'residual at-least-once delivery ambiguity this mirrors.',
      },
    });
  }

  private sanitizeError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message.replace(/[A-Za-z0-9+/]{40,}={0,2}/g, '[REDACTED]').slice(0, 1000);
  }
}
