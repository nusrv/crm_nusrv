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
import { generateStableMessageId } from './mail-message-id.util';
import { MAIL_TRANSPORT, type MailTransport } from './mail-transport';
import { MailThreadResolutionService } from './mail-thread-resolution.service';
import { STALE_PROCESSING_LEASE_MS } from './mail-timing.constants';
import { classifySmtpError } from './smtp-error-classification';

/** Internal signal only — never escapes MailOutboundService. Thrown inside a guarded
 * updateMany()'s transaction to abort/roll back the whole transaction when the ownership CAS
 * predicate no longer matches, and caught immediately by the method that threw it. */
class OwnershipLostError extends Error {}

const outboxContextInclude = {
  customer: true,
  subscription: true,
  renewalCase: { include: { holds: { where: { active: true } } } },
  notificationRule: true,
} as const;

type OutboxContext = Prisma.CommunicationOutboxGetPayload<{ include: typeof outboxContextInclude }>;

type EligibilityResult =
  | {
      kind: 'eligible';
      mailConfiguration: MailConfiguration;
      recipient: string;
      recipientChanged: boolean;
      oldRecipient: string;
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
 * Slice B outbound orchestrator. See PHASES/PHASE_03_MAIL_AI.md and the Slice B approval messages
 * for the full rule set; this class is the single place all of it is enforced.
 *
 * Phase 3.1 §D/§Q correction — there is NO global env-level enablement/cutover gate here any more.
 * MAIL_SEND_ENABLED/MAIL_SEND_CUTOVER_AT are deprecated/parsed-only (see environment.ts) and are
 * never read by this class. Every candidate row's mailbox is resolved fresh via
 * MailConfigurationResolverService inside evaluateEligibility(), which requires that mailbox's own
 * `outboundSendEnabled`/`outboundSendCutoverAt` (DB, admin-managed, Settings-driven) before treating
 * it as eligible — an unusable configuration for any reason (disabled mailbox, cutover not reached,
 * environment mismatch, etc.) defers the row exactly like before, just resolved per-mailbox instead
 * of via one global upfront gate. This is intentional: two different mailboxes can now have
 * completely independent enablement/cutover state, which a single global gate could never express.
 *
 * IDENTITY BOUNDARY: a logical outbound message's identity (recipient, MailConfiguration/mailbox,
 * Message-ID) is only ever mutable BEFORE its first real SMTP attempt (`attempts === 0`). Once any
 * attempt has occurred, that identity is PINNED — a previous attempt may have succeeded despite an
 * ambiguous network/SMTP outcome, so retrying to a different recipient, or through a different
 * mailbox, or under a regenerated Message-ID would risk sending a second, differently-addressed
 * copy of what might already be a delivered message.
 *
 * LEASE OWNERSHIP (hardening pass): a successful claim() persists a specific `lastAttemptAt` value
 * — that EXACT value, read back from the database (never a locally-computed `new Date()`), is this
 * worker's ownership/lease token for the entire remainder of processOne(). It is established once,
 * at claim time, and is NEVER rewritten again by this worker during a successful attempt — in
 * particular, marking the SMTP attempt increments `attempts` WITHOUT touching `lastAttemptAt`, so
 * the token stays valid start-to-finish. Every subsequent PROCESSING-state mutation this worker
 * makes (the recipient rebind, materializing the EmailMessage, incrementing attempts, and recording
 * success/failure) is a conditional write requiring `status = PROCESSING AND lastAttemptAt =
 * <this worker's token>` in the same statement/transaction as the mutation itself. If a second
 * worker's stale-PROCESSING reclaim (see claim()) has since written a NEW `lastAttemptAt`, every one
 * of those conditional writes fails (`count !== 1`) and is rolled back — the stale worker can no
 * longer touch the row in any way, no matter how far into processOne() it already was. This is the
 * actual correctness mechanism; the SMTP-timeout-vs-lease margin (see mail-timing.constants.ts) is
 * defense in depth that makes reaching this guard rare, not what makes it safe.
 *
 * Delivery model: a successful `transport.send()` call means the SMTP server ACCEPTED the message
 * for delivery, not that it reached an inbox. SMTP cannot be committed atomically with our database
 * transaction, so a crash — or an ownership-loss discovered only after the SMTP call already
 * returned — between "SMTP accepted" and "DB updated to DELIVERED" is possible and cannot be fully
 * eliminated (see 'ownership_lost_after_send' below). The combination of a stable, retry-safe
 * Message-ID, idempotent EmailMessage materialization, a single-row atomic claim, the ownership CAS,
 * and bounded retries makes this effectively AT-LEAST-ONCE delivery under ambiguous SMTP/network
 * failure or ownership loss, never exactly-once — the database cannot undo an external SMTP side
 * effect a worker already triggered before it discovered it had lost ownership.
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
    const staleThreshold = this.staleThreshold(now);
    // Claim predicate (exact — see also claim()): a row is a candidate when it is either freshly
    // QUEUED (lastAttemptAt may be NULL — the two OR-branches are independent, so a NULL
    // lastAttemptAt never has to satisfy the stale-PROCESSING branch's own condition), or PROCESSING
    // with a lastAttemptAt older than the stale lease — never both at once. Phase 3.1 §D correction:
    // deliberately no `createdAt >= cutover` pre-filter here any more — cutover is now per-mailbox
    // (MailConfiguration.outboundSendCutoverAt), checked once each candidate's mailbox is resolved
    // in evaluateEligibility(), never at this global query level.
    const candidates = await this.prisma.communicationOutbox.findMany({
      where: {
        scheduledAt: { lte: now },
        OR: [
          { status: CommunicationOutboxStatus.QUEUED },
          { status: CommunicationOutboxStatus.PROCESSING, lastAttemptAt: { lt: staleThreshold } },
        ],
      },
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

  /**
   * Processes a single CommunicationOutbox row end to end: claim -> revalidate -> (rebind if
   * still pre-attempt) -> materialize -> final revalidate -> (rebind if still pre-attempt) -> mark
   * attempt -> send -> record. Safe to call concurrently for the same id from multiple
   * workers/processes — every mutation past the initial claim is guarded by the exact lease token
   * that claim() returned, so a stale worker can never overwrite a newer owner's state (see the
   * class-level LEASE OWNERSHIP doc comment).
   */
  async processOne(outboxId: string): Promise<OutboxProcessingOutcome> {
    const now = this.clock.now();
    const leaseToken = await this.claim(outboxId, now);
    if (!leaseToken) return 'not_claimed';

    try {
      const row = await this.loadContext(outboxId);
      const eligibility = await this.evaluateEligibility(row, now);
      if (eligibility.kind !== 'eligible') {
        return await this.resolveNonEligible(outboxId, row, eligibility, leaseToken);
      }

      let currentRecipient = eligibility.recipient;
      if (eligibility.recipientChanged) {
        const rebindOutcome = await this.rebindRecipientAndMessage(
          row,
          eligibility.oldRecipient,
          eligibility.recipient,
          leaseToken,
        );
        if (rebindOutcome === 'conflict') return 'conflict';
      }

      const materialized = await this.materialize(
        row,
        eligibility.mailConfiguration,
        currentRecipient,
        now,
        leaseToken,
      );

      // Final, lightweight pre-send revalidation — a FRESH read of current customer/subscription/
      // case/hold/recipient/mailbox state (never the loadContext() snapshot from above, which is
      // already stale by construction), narrowing the race between materialization (a DB
      // transaction, already committed) and the external SMTP call below. Because no SMTP attempt
      // has happened yet (attempts is still 0 here), a recipient change at this point is still
      // reboundable — see evaluateEligibility()'s attempts===0 branch — and is rebound consistently
      // across CommunicationOutbox.recipient, the already-materialized EmailMessage.toAddressesJson,
      // and the address about to be handed to the transport, atomically, before any send is
      // attempted. No DB transaction is held open across this gap or across the network call that
      // follows.
      const freshRow = await this.loadContext(outboxId);
      const final = await this.evaluateEligibility(freshRow, this.clock.now());
      if (final.kind !== 'eligible') {
        return await this.resolveNonEligible(outboxId, freshRow, final, leaseToken);
      }
      if (final.recipientChanged) {
        const rebindOutcome = await this.rebindRecipientAndMessage(
          freshRow,
          final.oldRecipient,
          final.recipient,
          leaseToken,
        );
        if (rebindOutcome === 'conflict') return 'conflict';
        currentRecipient = final.recipient;
      }

      const attemptMarked = await this.markAttempt(outboxId, leaseToken);
      if (!attemptMarked) {
        // Ownership lost before the SMTP call — safe: nothing external has happened yet.
        return 'conflict';
      }

      let sendError: { failed: true; error: unknown } | { failed: false } = { failed: false };
      try {
        await this.transport.send(
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
        );
      } catch (error) {
        sendError = { failed: true, error };
      }

      if (!sendError.failed) {
        const recorded = await this.recordSuccess(outboxId, materialized.mailConfiguration.id, leaseToken);
        return recorded ? 'sent' : 'ownership_lost_after_send';
      }
      const recorded = await this.recordFailure(
        outboxId,
        materialized.mailConfiguration.id,
        sendError.error,
        leaseToken,
      );
      return recorded ? 'failed' : 'ownership_lost_after_send';
    } catch (error) {
      if (error instanceof OwnershipLostError) return 'conflict';
      throw error;
    }
  }

  private staleThreshold(now: Date): Date {
    return new Date(now.getTime() - STALE_PROCESSING_LEASE_MS);
  }

  /**
   * Exact claim predicate (fresh QUEUED claim vs. stale-PROCESSING reclaim — two independent
   * OR-branches, never conflated):
   *
   *   (status = QUEUED)                                           <- fresh claim; lastAttemptAt
   *                                                                   irrelevant here, so a brand
   *                                                                   new row with lastAttemptAt
   *                                                                   NULL is always claimable.
   *   OR
   *   (status = PROCESSING AND lastAttemptAt < staleLeaseCutoff)   <- stale-lease reclaim only.
   *
   * Phase 3.1 §D correction — no `createdAt >= cutover` clause here any more; a "historical" row's
   * protection now comes entirely from its resolved mailbox's own outboundSendCutoverAt, checked in
   * evaluateEligibility() after claim — never at claim time, and never a global watermark.
   *
   * Returns the lease/ownership token (the EXACT `lastAttemptAt` MariaDB actually persisted, read
   * back rather than assumed to equal the `now` we wrote — see the class-level LEASE OWNERSHIP doc
   * comment for why: this makes the token correct regardless of the column's DATETIME precision,
   * with no need to reason about round-tripping at all) on success, or null if the claim was lost.
   */
  private async claim(id: string, now: Date): Promise<Date | null> {
    const result = await this.prisma.communicationOutbox.updateMany({
      where: {
        id,
        OR: [
          { status: CommunicationOutboxStatus.QUEUED },
          { status: CommunicationOutboxStatus.PROCESSING, lastAttemptAt: { lt: this.staleThreshold(now) } },
        ],
      },
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
        recipientChanged: false,
        oldRecipient: row.recipient,
      };
    }

    if (row.customer.status !== CustomerStatus.ACTIVE) {
      return { kind: 'cancel', reason: 'customer_inactive' };
    }
    if (row.subscription.status !== SubscriptionStatus.ACTIVE) {
      return { kind: 'cancel', reason: 'subscription_inactive' };
    }
    if (!isReminderEligible(row.renewalCase.status)) {
      return { kind: 'cancel', reason: `case_not_reminder_eligible:${row.renewalCase.status}` };
    }
    const holdPolicy = aggregateEffectiveHolds(row.renewalCase.holds, now);
    if (holdPolicy.stopCustomerReminders) {
      return { kind: 'defer', reason: 'customer_reminder_hold' };
    }

    // Recipient identity boundary: before any SMTP attempt (attempts === 0), the authoritative
    // recipient may still change and is rebound. Once an attempt has occurred, the message's
    // addressed identity is pinned — a changed or now-missing recipient after that point is a
    // business decision (cancel + audit), never a silent retry-to-old or mutate-to-new.
    const resolved = await this.emailResolution.resolvePrimaryRecipient(row.customerId);
    const attempted = row.attempts > 0;

    if (!resolved) {
      if (!attempted) return { kind: 'defer', reason: 'no_current_recipient' };
      return {
        kind: 'cancel',
        reason: 'recipient_unavailable_after_attempt',
        metadata: { oldRecipient: row.recipient },
      };
    }

    if (resolved.email !== row.recipient) {
      if (!attempted) {
        return {
          kind: 'eligible',
          mailConfiguration,
          recipient: resolved.email,
          recipientChanged: true,
          oldRecipient: row.recipient,
        };
      }
      return {
        kind: 'cancel',
        reason: 'recipient_changed_after_attempt',
        metadata: { oldRecipient: row.recipient, newRecipient: resolved.email },
      };
    }

    return {
      kind: 'eligible',
      mailConfiguration,
      recipient: resolved.email,
      recipientChanged: false,
      oldRecipient: row.recipient,
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
      data: { status: CommunicationOutboxStatus.QUEUED, lastError: reason },
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

  /** Rebinds a not-yet-attempted job to the current authoritative recipient — atomically across
   * CommunicationOutbox.recipient AND (when already materialized) EmailMessage.toAddressesJson, so
   * the two can never disagree with each other or with what is about to be handed to the
   * transport. Must never touch an already-attempted (pinned) row, and must never touch a row this
   * worker no longer owns.
   *
   * The conditional write requires, all inside the same transaction, before mutating anything:
   * `id` matches, `status = PROCESSING`, `lastAttemptAt = expectedLeaseTimestamp` (this worker's
   * lease token — see the class-level LEASE OWNERSHIP doc comment), AND `attempts = 0`. If any of
   * those no longer holds — a second worker's stale-PROCESSING reclaim wrote a new lastAttemptAt,
   * or (redundantly, but defensively) attempts has already advanced — the whole transaction is
   * aborted and 'conflict' is returned: neither CommunicationOutbox.recipient nor
   * EmailMessage.toAddressesJson is touched, and no SMTP call follows.
   */
  private async rebindRecipientAndMessage(
    row: OutboxContext,
    oldRecipient: string,
    newRecipient: string,
    expectedLeaseTimestamp: Date,
  ): Promise<'rebound' | 'conflict'> {
    try {
      await this.prisma.$transaction(async (tx) => {
        const guarded = await tx.communicationOutbox.updateMany({
          where: {
            id: row.id,
            status: CommunicationOutboxStatus.PROCESSING,
            lastAttemptAt: expectedLeaseTimestamp,
            attempts: 0,
          },
          data: { recipient: newRecipient },
        });
        if (guarded.count !== 1) {
          throw new OwnershipLostError();
        }
        if (row.emailMessageId) {
          await tx.emailMessage.update({
            where: { id: row.emailMessageId },
            data: { toAddressesJson: [newRecipient] },
          });
        }
        await this.audit.record(
          {
            actorType: ActorType.SYSTEM,
            eventKey: 'mail.recipient.rebound',
            subjectType: 'CommunicationOutbox',
            subjectId: row.id,
            metadata: {
              oldRecipient,
              newRecipient,
              renewalCaseId: row.renewalCaseId,
              emailMessageUpdated: Boolean(row.emailMessageId),
            },
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
  private async markAttempt(outboxId: string, expectedLeaseTimestamp: Date): Promise<boolean> {
    const result = await this.prisma.communicationOutbox.updateMany({
      where: { id: outboxId, status: CommunicationOutboxStatus.PROCESSING, lastAttemptAt: expectedLeaseTimestamp },
      data: { attempts: { increment: 1 } },
    });
    return result.count === 1;
  }

  /** Returns false if this worker's lease token no longer matches — meaning SMTP already accepted
   * the message, but a newer worker now owns this row and its state must not be overwritten. That
   * ambiguity is reported (not silently swallowed) via a dedicated, always-safe-to-write audit
   * event — auditing never mutates the CommunicationOutbox row itself, so it carries no ownership
   * risk of its own. */
  private async recordSuccess(
    outboxId: string,
    mailConfigurationId: string,
    expectedLeaseTimestamp: Date,
  ): Promise<boolean> {
    const guarded = await this.prisma.$transaction(async (tx) => {
      const result = await tx.communicationOutbox.updateMany({
        where: { id: outboxId, status: CommunicationOutboxStatus.PROCESSING, lastAttemptAt: expectedLeaseTimestamp },
        data: { status: CommunicationOutboxStatus.DELIVERED, lastError: null },
      });
      if (result.count !== 1) return false;
      await this.audit.record(
        {
          actorType: ActorType.SYSTEM,
          eventKey: 'mail.send.succeeded',
          subjectType: 'CommunicationOutbox',
          subjectId: outboxId,
        },
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

  /** Classifies the failure (see smtp-error-classification.ts) before deciding both the outbox
   * outcome and whether MailConfiguration health is affected at all: a permanent, message-specific
   * rejection (e.g. a 5xx RCPT TO) fails only this row, terminally, and never touches health —
   * one bad recipient must never mark the whole mailbox UNAVAILABLE. An infrastructure failure
   * (auth/connection/socket/DNS/timeout, or an unrecognized shape) is bounded-retried as before and
   * does report health. Ownership-guarded like recordSuccess() — see its doc comment for the
   * false-return/ownership-loss-after-transmission handling, which applies identically here. */
  private async recordFailure(
    outboxId: string,
    mailConfigurationId: string,
    error: unknown,
    expectedLeaseTimestamp: Date,
  ): Promise<boolean> {
    const sanitized = this.sanitizeError(error);
    const classification = classifySmtpError(error);
    const current = await this.prisma.communicationOutbox.findUniqueOrThrow({
      where: { id: outboxId },
      select: { attempts: true },
    });
    const boundExhausted = current.attempts >= MailOutboundService.MAX_SEND_ATTEMPTS;
    const terminal = classification.terminal || boundExhausted;
    const nextStatus = terminal ? CommunicationOutboxStatus.FAILED : CommunicationOutboxStatus.QUEUED;
    const guarded = await this.prisma.$transaction(async (tx) => {
      const result = await tx.communicationOutbox.updateMany({
        where: { id: outboxId, status: CommunicationOutboxStatus.PROCESSING, lastAttemptAt: expectedLeaseTimestamp },
        data: { status: nextStatus, lastError: sanitized },
      });
      if (result.count !== 1) return false;
      if (terminal) {
        await this.audit.record(
          {
            actorType: ActorType.SYSTEM,
            eventKey: 'mail.send.failed',
            subjectType: 'CommunicationOutbox',
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

  /** Honest, best-effort record of the residual at-least-once ambiguity: SMTP was actually called
   * (and may have succeeded) but this worker had already lost row ownership by the time it tried
   * to persist the outcome, so the newer owner's state was correctly left untouched. Never
   * mutates CommunicationOutbox itself — an audit record is always safe to write regardless of
   * ownership. */
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
        note:
          'SMTP was called (outcome not necessarily known here) but this worker had already lost ' +
          'row ownership to a newer claimant before it could persist the result; the newer owner\'s ' +
          'state was preserved untouched. This is a residual at-least-once delivery ambiguity, not ' +
          'a bug — see MailOutboundService\'s delivery-model doc comment.',
      },
    });
  }

  /** Never persists a raw exception: strips anything resembling a base64 credential fragment and
   * caps length, so a leaky SMTP library error can never leak an AUTH secret into lastError/audit. */
  private sanitizeError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message.replace(/[A-Za-z0-9+/]{40,}={0,2}/g, '[REDACTED]').slice(0, 1000);
  }
}
