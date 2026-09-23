import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../../audit/audit.service';
import { PrismaService } from '../../database/prisma.service';
import { ClockService } from '../../time/clock.service';
import type { AiRoutingDecision, Prisma } from '../../generated/prisma/client';
import {
  ActorType,
  AiIntent,
  AiRoutingAction,
  AiRoutingStatus,
  ClassificationStatus,
  CustomerDecision,
  MessageDirection,
  RenewalCaseStatus,
  ThreadStatus,
} from '../../generated/prisma/enums';
import { applyRenewalCaseTransition, isLegalRenewalCaseTransition } from '../renewal-cases/renewal-transition-policy';
import { AI_ROUTING_AUDIT_EVENT, AI_ROUTING_RECOVERY_SCAN_BATCH_SIZE, AI_ROUTING_RESULT_CODE, AI_ROUTING_STALE_PROCESSING_LEASE_MS } from './ai-routing.constants';

/** Internal signal only — never escapes this class. Mirrors OperatorReplyOutboundService's own use
 * of the identical pattern: thrown inside a guarded transaction to abort/roll back when a CAS
 * predicate no longer matches, caught immediately by the method that threw it. */
class RoutingAbortedError extends Error {
  constructor(public readonly reason: 'email_message_changed' | 'case_changed' | 'ownership_lost') {
    super(reason);
  }
}

export type AiRoutingOutcome = 'succeeded' | 'skipped' | 'failed' | 'not_claimed' | 'conflict' | 'paused';

export interface AiRoutingBatchSummary {
  candidates: number;
  succeeded: number;
  skipped: number;
  failed: number;
  notClaimed: number;
  conflicts: number;
  paused: number;
}

type RoutedMessageContext = { id: string; threadId: string };

/**
 * Slice G §9-§16 — the ONE place a durable AiRoutingDecision is actually executed. Mirrors
 * OperatorReplyOutboundService's claim/lease/CAS architecture exactly (same discipline, not a
 * copy): PENDING/stale-PROCESSING claim via a guarded `updateMany`, the exact persisted
 * `lastAttemptAt` read back as the lease token, every subsequent write re-checking
 * `{status: PROCESSING, lastAttemptAt: leaseToken}`.
 *
 * §10 (the human-review race) — closed using the EmailMessage row itself as the shared DB ownership
 * boundary, never a new ClassificationStatus value. ClassificationReviewService's own transaction
 * (see that file's doc comment) touches EmailMessage as its FIRST write, unconditionally setting
 * RESOLVED; this service's AUTO_ACCEPT transaction touches the SAME row as ITS first write too — a
 * same-value guarded `updateMany({where:{classificationStatus: CLASSIFIED}, data:{classificationStatus:
 * CLASSIFIED}})` "touch" that (a) takes the identical InnoDB row lock any other UPDATE on this row
 * would, so whichever transaction's write commits first genuinely wins, and (b) fails cleanly (0
 * rows) if a review already flipped the status away from CLASSIFIED. No last-write-wins is possible
 * for either side.
 *
 * Only ACCEPT_RENEWAL ever mutates business state (AUTO_ACCEPT). Every other action
 * (HUMAN_REVIEW) only ever moves EmailMessage/CommunicationThread into HUMAN_REVIEW — it never
 * touches RenewalCase, never calls SMTP/Fawtara/Plesk/SmarterMail, never creates
 * Invoice/PaymentRecord/RetentionCase/ApprovalRequest/TechnicalAction (none of which exist in this
 * schema at all).
 */
@Injectable()
export class AiRoutingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clock: ClockService,
    private readonly config: ConfigService,
  ) {}

  async processBatch(): Promise<AiRoutingBatchSummary> {
    const now = this.clock.now();
    const staleThreshold = this.staleThreshold(now);
    // Contract-audit hardening §4 — while AI_AUTO_ROUTE_ACCEPT is off, AUTO_ACCEPT decisions are
    // excluded from the candidate set entirely, so the periodic scanner never repeatedly re-selects
    // a paused row every tick. HUMAN_REVIEW decisions are never affected by this switch — excluding
    // them too would incorrectly pause a routing action that has nothing to do with automatic
    // acceptance. No new column, no retry-scheduling change: this is a query-time filter only.
    const autoAcceptEnabled = this.autoRouteAcceptEnabled();
    const actionFilter = autoAcceptEnabled ? {} : { action: AiRoutingAction.HUMAN_REVIEW };
    // §20 — bounded, deterministic order. Scans ONLY AiRoutingDecision — never AiClassification —
    // so a historical classification created before Slice G existed (and therefore has no decision
    // row at all) can never be discovered here and can never automatically execute.
    const candidates = await this.prisma.aiRoutingDecision.findMany({
      where: {
        OR: [
          { status: AiRoutingStatus.PENDING, ...actionFilter },
          { status: AiRoutingStatus.PROCESSING, lastAttemptAt: { lt: staleThreshold }, ...actionFilter },
        ],
      },
      select: { id: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: AI_ROUTING_RECOVERY_SCAN_BATCH_SIZE,
    });

    const summary: AiRoutingBatchSummary = { candidates: candidates.length, succeeded: 0, skipped: 0, failed: 0, notClaimed: 0, conflicts: 0, paused: 0 };
    for (const candidate of candidates) {
      const outcome = await this.processOne(candidate.id);
      if (outcome === 'succeeded') summary.succeeded += 1;
      else if (outcome === 'skipped') summary.skipped += 1;
      else if (outcome === 'failed') summary.failed += 1;
      else if (outcome === 'not_claimed') summary.notClaimed += 1;
      else if (outcome === 'conflict') summary.conflicts += 1;
      else if (outcome === 'paused') summary.paused += 1;
    }
    return summary;
  }

  async processOne(decisionId: string): Promise<AiRoutingOutcome> {
    // Contract-audit hardening §3 — the execution kill switch. Checked BEFORE claim() so a paused
    // AUTO_ACCEPT decision consumes zero attempts, its lease/status/action are left completely
    // untouched, and no audit event is written. This does NOT reinterpret the decision: `action`
    // stays AUTO_ACCEPT forever — only EXECUTION is paused, and the same durable row resumes
    // normally once the switch is restored, via the same claim/lease path (recovery or a fresh
    // enqueue). A HUMAN_REVIEW decision is never affected by this check.
    const peek = await this.prisma.aiRoutingDecision.findUnique({ where: { id: decisionId }, select: { action: true } });
    if (peek?.action === AiRoutingAction.AUTO_ACCEPT && !this.autoRouteAcceptEnabled()) {
      return 'paused';
    }

    const now = this.clock.now();
    const leaseToken = await this.claim(decisionId, now);
    if (!leaseToken) return 'not_claimed';

    const decision = await this.prisma.aiRoutingDecision.findUniqueOrThrow({ where: { id: decisionId } });
    return decision.action === AiRoutingAction.AUTO_ACCEPT
      ? this.executeAutoAccept(decision, leaseToken)
      : this.executeHumanReviewRouting(decision, leaseToken);
  }

  private autoRouteAcceptEnabled(): boolean {
    return this.config.get<string>('AI_AUTO_ROUTE_ACCEPT') === 'true';
  }

  private staleThreshold(now: Date): Date {
    return new Date(now.getTime() - AI_ROUTING_STALE_PROCESSING_LEASE_MS);
  }

  /** §9 — same claim predicate/lease-token discipline as OperatorReplyOutboundService.claim() /
   * MailOutboundService.claim(). */
  private async claim(id: string, now: Date): Promise<Date | null> {
    const result = await this.prisma.aiRoutingDecision.updateMany({
      where: {
        id,
        OR: [
          { status: AiRoutingStatus.PENDING },
          { status: AiRoutingStatus.PROCESSING, lastAttemptAt: { lt: this.staleThreshold(now) } },
        ],
      },
      data: { status: AiRoutingStatus.PROCESSING, lastAttemptAt: now, attempts: { increment: 1 } },
    });
    if (result.count !== 1) return null;
    const persisted = await this.prisma.aiRoutingDecision.findUniqueOrThrow({ where: { id }, select: { lastAttemptAt: true } });
    if (!persisted.lastAttemptAt) {
      throw new Error(`Internal consistency error: claim() succeeded for routing decision ${id} but lastAttemptAt is null.`);
    }
    return persisted.lastAttemptAt;
  }

  /** §11-§14 — the AUTO_ACCEPT path. Every eligibility fact is re-derived fresh here (never trusted
   * from classification time, except `decision.action` itself, which is frozen per §6 and never
   * re-decided). */
  private async executeAutoAccept(decision: AiRoutingDecision, leaseToken: Date): Promise<AiRoutingOutcome> {
    const classification = await this.prisma.aiClassification.findUniqueOrThrow({
      where: { id: decision.aiClassificationId },
      include: {
        emailMessage: { select: { id: true, threadId: true, direction: true, classificationStatus: true, renewalCaseId: true } },
      },
    });
    const message = classification.emailMessage;

    // Defensive invariant checks only — AiClassification is immutable, so these facts cannot
    // actually differ from what decideClassificationTimeRoutingAction() already observed. A failure
    // here indicates a real application bug, never a legitimate concurrent business event, so it is
    // FAILED (not SKIPPED) and never silently retried.
    if (
      message.direction !== MessageDirection.INBOUND ||
      classification.requiresHumanReview ||
      classification.intent !== AiIntent.ACCEPT_RENEWAL ||
      Number(classification.confidence) < (this.config.get<number>('AI_CONFIDENCE_THRESHOLD') ?? 0.9)
    ) {
      await this.finalizeDecisionOnly(decision.id, leaseToken, AiRoutingStatus.FAILED, AI_ROUTING_RESULT_CODE.INVARIANT_VIOLATION);
      return 'failed';
    }

    // §H/§9 — must still be the latest classification for this message.
    const latest = await this.prisma.aiClassification.findFirst({
      where: { emailMessageId: message.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true },
    });
    if (latest?.id !== classification.id) {
      await this.finalizeDecisionOnly(decision.id, leaseToken, AiRoutingStatus.SKIPPED, AI_ROUTING_RESULT_CODE.SKIPPED_CLASSIFICATION_SUPERSEDED);
      return 'skipped';
    }

    if (!message.renewalCaseId) {
      await this.routeToHumanReviewFallback(decision.id, leaseToken, message, AI_ROUTING_RESULT_CODE.SKIPPED_NO_RENEWAL_CASE);
      return 'skipped';
    }
    const renewalCase = await this.prisma.renewalCase.findUnique({ where: { id: message.renewalCaseId } });
    if (!renewalCase) {
      await this.routeToHumanReviewFallback(decision.id, leaseToken, message, AI_ROUTING_RESULT_CODE.SKIPPED_NO_RENEWAL_CASE);
      return 'skipped';
    }
    if (renewalCase.status === RenewalCaseStatus.ACCEPTED) {
      // §14 — already reached the exact desired state through a legitimate concurrent action; never
      // fabricate ownership of that transition, never touch the message/thread.
      await this.finalizeDecisionOnly(decision.id, leaseToken, AiRoutingStatus.SKIPPED, AI_ROUTING_RESULT_CODE.SKIPPED_ALREADY_ACCEPTED);
      return 'skipped';
    }
    if (!isLegalRenewalCaseTransition(renewalCase.status, RenewalCaseStatus.ACCEPTED)) {
      // §14 — moved to an incompatible/terminal state; never override it, but do surface the
      // message/thread for human attention since nothing else will.
      await this.routeToHumanReviewFallback(decision.id, leaseToken, message, AI_ROUTING_RESULT_CODE.SKIPPED_CONCURRENT_BUSINESS_DECISION);
      return 'skipped';
    }

    // §10 defense-in-depth pre-check — the EmailMessage CAS inside the transaction below is the
    // actual, authoritative race-closing mechanism; this is a fast, cheap early exit only.
    const reviewExists = await this.prisma.classificationReview.findFirst({
      where: { aiClassificationId: classification.id },
      select: { id: true },
    });
    if (reviewExists) {
      await this.finalizeDecisionOnly(decision.id, leaseToken, AiRoutingStatus.SKIPPED, AI_ROUTING_RESULT_CODE.SKIPPED_HUMAN_ALREADY_REVIEWED);
      return 'skipped';
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        // §13.A / §10 — the guarded EmailMessage touch: same value in, same value out
        // (CLASSIFIED -> CLASSIFIED), but a real UPDATE statement, so it takes the same row lock any
        // other write to this row would, and fails cleanly (0 rows) if a review already moved the
        // status away from CLASSIFIED.
        const emailTouch = await tx.emailMessage.updateMany({
          where: { id: message.id, classificationStatus: ClassificationStatus.CLASSIFIED },
          data: { classificationStatus: ClassificationStatus.CLASSIFIED },
        });
        if (emailTouch.count !== 1) throw new RoutingAbortedError('email_message_changed');

        // §13.B/C — reuses the SAME legal-transition + CAS primitive RenewalCasesService itself
        // uses, never a second copy.
        const transition = await applyRenewalCaseTransition(tx, this.audit, {
          id: renewalCase.id,
          currentRow: renewalCase,
          toStatus: RenewalCaseStatus.ACCEPTED,
          extraData: { customerDecision: CustomerDecision.ACCEPTED, acceptedAt: this.clock.now() },
          eventKey: AI_ROUTING_AUDIT_EVENT.AUTO_ACCEPTED,
          actor: { actorType: ActorType.AI }, // §12/§0.H — actorId intentionally omitted (never a synthetic user id).
          auditMetadata: {
            aiClassificationId: classification.id,
            emailMessageId: message.id,
            threadId: message.threadId,
            renewalCaseId: renewalCase.id,
            intent: classification.intent,
            confidence: classification.confidence,
            routingVersion: decision.routingVersion,
            resultCode: AI_ROUTING_RESULT_CODE.AUTO_ACCEPTED,
          },
        });
        if (transition.kind === 'cas_lost') throw new RoutingAbortedError('case_changed');

        // §13.D
        const decisionUpdate = await tx.aiRoutingDecision.updateMany({
          where: { id: decision.id, status: AiRoutingStatus.PROCESSING, lastAttemptAt: leaseToken },
          data: { status: AiRoutingStatus.SUCCEEDED, resultCode: AI_ROUTING_RESULT_CODE.AUTO_ACCEPTED, completedAt: this.clock.now() },
        });
        if (decisionUpdate.count !== 1) throw new RoutingAbortedError('ownership_lost');
      });
      return 'succeeded';
    } catch (error) {
      if (!(error instanceof RoutingAbortedError)) throw error;
      if (error.reason === 'ownership_lost') return 'conflict';
      return this.resolveAutoAcceptAbort(decision.id, leaseToken, message, renewalCase.id, error.reason);
    }
  }

  /** §14 — the transaction above rolled back entirely; re-read fresh state OUTSIDE it to classify
   * exactly why, then finalize accordingly. Never retried blindly. */
  private async resolveAutoAcceptAbort(
    decisionId: string,
    leaseToken: Date,
    message: RoutedMessageContext,
    renewalCaseId: string,
    reason: 'email_message_changed' | 'case_changed',
  ): Promise<AiRoutingOutcome> {
    if (reason === 'email_message_changed') {
      await this.finalizeDecisionOnly(decisionId, leaseToken, AiRoutingStatus.SKIPPED, AI_ROUTING_RESULT_CODE.SKIPPED_HUMAN_ALREADY_REVIEWED);
      return 'skipped';
    }
    const fresh = await this.prisma.renewalCase.findUniqueOrThrow({ where: { id: renewalCaseId } });
    if (fresh.status === RenewalCaseStatus.ACCEPTED) {
      await this.finalizeDecisionOnly(decisionId, leaseToken, AiRoutingStatus.SKIPPED, AI_ROUTING_RESULT_CODE.SKIPPED_ALREADY_ACCEPTED);
      return 'skipped';
    }
    await this.routeToHumanReviewFallback(decisionId, leaseToken, message, AI_ROUTING_RESULT_CODE.SKIPPED_CONCURRENT_BUSINESS_DECISION);
    return 'skipped';
  }

  /** §15 — the "Otherwise" PENDING HUMAN_REVIEW decision's normal execution. Never touches
   * RenewalCase. */
  private async executeHumanReviewRouting(decision: AiRoutingDecision, leaseToken: Date): Promise<AiRoutingOutcome> {
    const classification = await this.prisma.aiClassification.findUniqueOrThrow({
      where: { id: decision.aiClassificationId },
      include: { emailMessage: { select: { id: true, threadId: true } } },
    });
    const message = classification.emailMessage;

    try {
      const decisionStatus = await this.prisma.$transaction(async (tx) => {
        const routing = await this.tryRouteEmailAndThreadToHumanReview(tx, message);
        const resultCode =
          routing === 'already_resolved' ? AI_ROUTING_RESULT_CODE.SKIPPED_HUMAN_ALREADY_REVIEWED : AI_ROUTING_RESULT_CODE.ROUTED_TO_HUMAN_REVIEW;
        const finalStatus = routing === 'already_resolved' ? AiRoutingStatus.SKIPPED : AiRoutingStatus.SUCCEEDED;

        const decisionUpdate = await tx.aiRoutingDecision.updateMany({
          where: { id: decision.id, status: AiRoutingStatus.PROCESSING, lastAttemptAt: leaseToken },
          data: { status: finalStatus, resultCode, completedAt: this.clock.now() },
        });
        if (decisionUpdate.count !== 1) throw new RoutingAbortedError('ownership_lost');

        if (routing !== 'already_resolved') {
          await this.audit.record(
            {
              actorType: ActorType.AI,
              eventKey: AI_ROUTING_AUDIT_EVENT.HUMAN_REVIEW_ROUTED,
              subjectType: 'EmailMessage',
              subjectId: message.id,
              metadata: {
                aiClassificationId: classification.id,
                emailMessageId: message.id,
                threadId: message.threadId,
                renewalCaseId: decision.renewalCaseId,
                intent: classification.intent,
                confidence: classification.confidence,
                routingVersion: decision.routingVersion,
                resultCode,
              },
            },
            tx,
          );
        }
        return finalStatus;
      });
      return decisionStatus === AiRoutingStatus.SUCCEEDED ? 'succeeded' : 'skipped';
    } catch (error) {
      if (error instanceof RoutingAbortedError && error.reason === 'ownership_lost') return 'conflict';
      throw error;
    }
  }

  /** Shared by executeHumanReviewRouting and the AUTO_ACCEPT fallback path. Idempotent and
   * non-destructive: never downgrades a RESOLVED message/thread back to HUMAN_REVIEW (§15). */
  private async tryRouteEmailAndThreadToHumanReview(
    tx: Prisma.TransactionClient,
    message: RoutedMessageContext,
  ): Promise<'routed' | 'already_human_review' | 'already_resolved'> {
    const current = await tx.emailMessage.findUniqueOrThrow({ where: { id: message.id }, select: { classificationStatus: true } });
    if (current.classificationStatus === ClassificationStatus.RESOLVED) return 'already_resolved';
    if (current.classificationStatus === ClassificationStatus.HUMAN_REVIEW) return 'already_human_review';

    const emailUpdate = await tx.emailMessage.updateMany({
      where: { id: message.id, classificationStatus: ClassificationStatus.CLASSIFIED },
      data: { classificationStatus: ClassificationStatus.HUMAN_REVIEW },
    });
    if (emailUpdate.count !== 1) {
      const recheck = await tx.emailMessage.findUniqueOrThrow({ where: { id: message.id }, select: { classificationStatus: true } });
      return recheck.classificationStatus === ClassificationStatus.RESOLVED ? 'already_resolved' : 'already_human_review';
    }
    // Never touches an already-RESOLVED thread (an operator's own explicit action) — only ever
    // escalates OPEN -> HUMAN_REVIEW, or no-ops if already HUMAN_REVIEW.
    await tx.communicationThread.updateMany({
      where: { id: message.threadId, status: { not: ThreadStatus.RESOLVED } },
      data: { status: ThreadStatus.HUMAN_REVIEW },
    });
    return 'routed';
  }

  /** §14 fallback — decision ends SKIPPED with the given reason, but the message/thread are still
   * separately routed to HUMAN_REVIEW where appropriate (never when a human already resolved it). */
  private async routeToHumanReviewFallback(
    decisionId: string,
    leaseToken: Date,
    message: RoutedMessageContext,
    defaultResultCode: string,
  ): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        const routing = await this.tryRouteEmailAndThreadToHumanReview(tx, message);
        const resultCode = routing === 'already_resolved' ? AI_ROUTING_RESULT_CODE.SKIPPED_HUMAN_ALREADY_REVIEWED : defaultResultCode;

        const decisionUpdate = await tx.aiRoutingDecision.updateMany({
          where: { id: decisionId, status: AiRoutingStatus.PROCESSING, lastAttemptAt: leaseToken },
          data: { status: AiRoutingStatus.SKIPPED, resultCode, completedAt: this.clock.now() },
        });
        if (decisionUpdate.count !== 1) throw new RoutingAbortedError('ownership_lost');

        if (routing === 'routed') {
          await this.audit.record(
            {
              actorType: ActorType.AI,
              eventKey: AI_ROUTING_AUDIT_EVENT.HUMAN_REVIEW_ROUTED,
              subjectType: 'EmailMessage',
              subjectId: message.id,
              metadata: { emailMessageId: message.id, threadId: message.threadId, resultCode },
            },
            tx,
          );
        }
      });
    } catch (error) {
      if (error instanceof RoutingAbortedError && error.reason === 'ownership_lost') return; // ownership genuinely lost; nothing more to do.
      throw error;
    }
  }

  private async finalizeDecisionOnly(decisionId: string, leaseToken: Date, status: AiRoutingStatus, resultCode: string): Promise<boolean> {
    const result = await this.prisma.aiRoutingDecision.updateMany({
      where: { id: decisionId, status: AiRoutingStatus.PROCESSING, lastAttemptAt: leaseToken },
      data: { status, resultCode, completedAt: this.clock.now() },
    });
    return result.count === 1;
  }
}
