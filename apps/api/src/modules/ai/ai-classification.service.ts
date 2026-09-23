import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { ClockService } from '../../time/clock.service';
import {
  ActorType,
  AiRoutingAction,
  AiRoutingStatus,
  ClassificationStatus,
  HealthStatus,
  MessageDirection,
} from '../../generated/prisma/enums';
import type { Prisma } from '../../generated/prisma/client';
import { AI_AUDIT_EVENT } from './ai-events.constants';
import { AiHealthService } from './ai-health.service';
import { AiSettingsResolverService, type AiRuntimeSettings } from './ai-settings-resolver.service';
import { buildClassificationInput, MAX_HISTORY_MESSAGES } from './ai-context.util';
import { decideClassificationTimeRoutingAction } from './ai-routing-eligibility.util';
import { AiRoutingEnqueueService } from './ai-routing-enqueue.service';
import { AI_ROUTING_RESULT_CODE, AI_ROUTING_VERSION } from './ai-routing.constants';
import { LLM_GATEWAY, PROMPT_VERSION } from './llm-gateway';
import type { LlmGateway, NormalizedClassificationResult } from './llm-gateway';
import { LlmMalformedOutputError, LlmPermanentError, LlmTransientError } from './llm-errors';

function sanitizeError(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 1000);
  return 'Unknown AI classification error.';
}

export type ClassifyMessageOutcome =
  | 'skipped_disabled'
  | 'skipped_ineligible'
  | 'classified'
  | 'human_review'
  | 'failed_human_review'
  | 'transient_retry'
  | 'lost_cas';

/**
 * Slice D — the one orchestrator for automatic inbound classification. Never decides eligibility
 * differently from what §9 defines, never holds a DB transaction open across the external LLM call
 * (§13), and never lets a provider/validation failure leave a message stuck in PENDING forever
 * (§12/§29).
 */
@Injectable()
export class AiClassificationService {
  constructor(
    private readonly prisma: PrismaService,
    // §D — deliberately NOT part of the dynamic AiSettings runtime config: AI_PROVIDER decides which
    // LlmGateway IMPLEMENTATION is wired into the DI container at boot (mock vs. real — see
    // llm-provider.module.ts), an infrastructure/deployment-level decision analogous to SMTP_MODE/
    // IMAP_MODE, never an admin-managed operational setting. Read here only to record which adapter
    // actually executed this one classification, as evidence metadata.
    private readonly config: ConfigService,
    private readonly aiSettings: AiSettingsResolverService,
    private readonly audit: AuditService,
    private readonly health: AiHealthService,
    private readonly clock: ClockService,
    private readonly routingEnqueue: AiRoutingEnqueueService,
    @Inject(LLM_GATEWAY) private readonly gateway: LlmGateway,
  ) {}

  /**
   * `isLastAttempt` must be supplied by the caller (the BullMQ worker), which is the only place
   * that knows the job's own attempt budget — see ai.worker.ts.
   */
  async classifyMessage(emailMessageId: string, isLastAttempt: boolean): Promise<ClassifyMessageOutcome> {
    // Phase 3.1 §J — resolved ONCE per attempt, from the persisted AiSettings row, read fresh every
    // call (never cached across attempts) so a Settings-UI change takes effect on the very next
    // classification with no restart. The same resolved settings object is threaded through to
    // persistClassification() below so a single attempt is judged by ONE consistent snapshot of
    // config, never two different reads racing a concurrent Settings change mid-attempt.
    const settings = await this.aiSettings.getSettings();
    if (!settings.enabled) {
      // §10 — no provider call, no classificationStatus change, no fake success, no health flap.
      return 'skipped_disabled';
    }

    const message = await this.prisma.emailMessage.findUnique({
      where: { id: emailMessageId },
      select: {
        id: true,
        threadId: true,
        subject: true,
        bodyText: true,
        occurredAt: true,
        createdAt: true,
        direction: true,
        classificationStatus: true,
        renewalCaseId: true,
      },
    });
    // §9 — eligibility is exact: INBOUND + EMAIL channel (EmailMessage.channel is always EMAIL in
    // this schema, so direction+status alone already fully expresses it) + PENDING. Anything else
    // (OUTBOUND, already HUMAN_REVIEW/CLASSIFIED/RESOLVED/FAILED, or a message that no longer
    // exists) is silently skipped — never an error, never a status change.
    if (!message || message.direction !== MessageDirection.INBOUND || message.classificationStatus !== ClassificationStatus.PENDING) {
      return 'skipped_ineligible';
    }

    const priorMessages = await this.loadPriorMessages(message.threadId, message.id, message.occurredAt);
    const input = buildClassificationInput(
      { subject: message.subject, bodyText: message.bodyText, occurredAt: message.occurredAt },
      priorMessages,
    );

    let normalized: NormalizedClassificationResult;
    try {
      normalized = await this.gateway.classifyIntent(input);
    } catch (error) {
      return this.handleClassificationFailure(emailMessageId, error, isLastAttempt);
    }

    await this.health.record(HealthStatus.HEALTHY, 'AI provider call succeeded.');

    const requiresReview =
      normalized.confidence < settings.confidenceThreshold ||
      normalized.requiresHumanReview ||
      normalized.intent === 'UNCLEAR';
    const finalStatus = requiresReview ? ClassificationStatus.HUMAN_REVIEW : ClassificationStatus.CLASSIFIED;

    const persisted = await this.persistClassification(
      emailMessageId,
      message.renewalCaseId,
      message.createdAt,
      message.occurredAt,
      normalized,
      finalStatus,
      settings,
    );
    if (!persisted) return 'lost_cas'; // §13 — CAS lost; another worker already owns this message.

    // Slice G §5/§8 — enqueue AFTER the classification+routing-decision transaction has already
    // committed, never before, never inside it. Only PENDING decisions (finalStatus === CLASSIFIED)
    // need a worker at all — an immediately-completed HUMAN_REVIEW decision (finalStatus ===
    // HUMAN_REVIEW) has nothing left to enqueue.
    if (finalStatus === ClassificationStatus.CLASSIFIED && persisted.routingDecisionId) {
      await this.routingEnqueue.enqueue(persisted.routingDecisionId);
    }

    return finalStatus === ClassificationStatus.CLASSIFIED ? 'classified' : 'human_review';
  }

  /** §8 — up to MAX_HISTORY_MESSAGES immediately preceding messages in the same thread, in
   * chronological order (oldest first). bodyText/subject/direction/occurredAt only — no
   * bodyHtml, no attachments, no raw MIME. */
  private async loadPriorMessages(threadId: string, currentMessageId: string, currentOccurredAt: Date) {
    const rows = await this.prisma.emailMessage.findMany({
      where: { threadId, id: { not: currentMessageId }, occurredAt: { lt: currentOccurredAt } },
      orderBy: { occurredAt: 'desc' },
      take: MAX_HISTORY_MESSAGES,
      select: { subject: true, bodyText: true, direction: true, occurredAt: true },
    });
    return rows.reverse(); // oldest first.
  }

  private async handleClassificationFailure(
    emailMessageId: string,
    error: unknown,
    isLastAttempt: boolean,
  ): Promise<ClassifyMessageOutcome> {
    if (error instanceof LlmTransientError) {
      await this.health.record(HealthStatus.DEGRADED, sanitizeError(error));
      if (!isLastAttempt) {
        // §12A — bounded queue retry; EmailMessage stays PENDING. Rethrow so BullMQ retries.
        throw error;
      }
      // §12D — retry budget exhausted.
      await this.transitionToHumanReview(emailMessageId, 'RETRY_BUDGET_EXHAUSTED', sanitizeError(error));
      return 'failed_human_review';
    }
    if (error instanceof LlmPermanentError) {
      // §12B — no pointless repeated retry where clearly terminal.
      await this.health.record(HealthStatus.UNAVAILABLE, sanitizeError(error));
      await this.transitionToHumanReview(emailMessageId, 'PROVIDER_PERMANENT_ERROR', sanitizeError(error));
      return 'failed_human_review';
    }
    if (error instanceof LlmMalformedOutputError) {
      // §12C / §16 — a message/classification-level failure only; never concludes the whole
      // provider is unavailable from one malformed response.
      await this.transitionToHumanReview(emailMessageId, 'MALFORMED_OUTPUT', sanitizeError(error));
      return 'failed_human_review';
    }
    // Unrecognized error shape — treat conservatively as transient-if-retryable, else terminal.
    await this.health.record(HealthStatus.DEGRADED, sanitizeError(error));
    if (!isLastAttempt) throw error;
    await this.transitionToHumanReview(emailMessageId, 'UNKNOWN_ERROR', sanitizeError(error));
    return 'failed_human_review';
  }

  /** §29 — PENDING -> HUMAN_REVIEW via CAS; never overwrites a message another worker/reviewer
   * already moved out of PENDING; audits only when this call actually owns the transition. */
  private async transitionToHumanReview(emailMessageId: string, reasonCode: string, detail: string): Promise<void> {
    const guarded = await this.prisma.emailMessage.updateMany({
      where: { id: emailMessageId, direction: MessageDirection.INBOUND, classificationStatus: ClassificationStatus.PENDING },
      data: { classificationStatus: ClassificationStatus.HUMAN_REVIEW },
    });
    if (guarded.count !== 1) return; // Lost the CAS — stop safely, no audit.

    await this.audit.record({
      actorType: ActorType.AI,
      eventKey: AI_AUDIT_EVENT.CLASSIFICATION_FAILED,
      subjectType: 'EmailMessage',
      subjectId: emailMessageId,
      metadata: { reason: reasonCode, detail },
    });
  }

  /** §13/Slice G §5 — the DB transaction is the final concurrency boundary:
   * EmailMessage.classificationStatus = PENDING is the CAS ownership check, and BOTH the
   * AiClassification row AND its AiRoutingDecision are created in the SAME transaction, so a losing
   * worker's transaction rolls back entirely (no orphan AiClassification, and — new in Slice G — no
   * AiClassification can ever exist without exactly one AiRoutingDecision, and vice versa; see
   * ai-routing.constants.ts / schema.prisma's AiRoutingDecision doc comment). Returns null when the
   * CAS was lost. */
  private async persistClassification(
    emailMessageId: string,
    renewalCaseId: string | null,
    messageCreatedAt: Date,
    messageOccurredAt: Date,
    normalized: NormalizedClassificationResult,
    finalStatus: ClassificationStatus,
    settings: AiRuntimeSettings,
  ): Promise<{ routingDecisionId: string } | null> {
    const provider = this.config.get<string>('AI_PROVIDER') ?? 'mock';
    // The mock gateway never reads AiSettings.model at all, so when provider === 'mock' this
    // evidence field is fixed to 'mock' regardless of whatever model happens to be configured —
    // exactly mirroring this method's pre-Phase-3.1 behavior for the mock path.
    const model = provider === 'mock' ? 'mock' : (settings.model ?? 'unknown');
    const now = this.clock.now();

    const result = await this.prisma.$transaction(async (tx) => {
      const cas = await tx.emailMessage.updateMany({
        where: { id: emailMessageId, direction: MessageDirection.INBOUND, classificationStatus: ClassificationStatus.PENDING },
        data: { classificationStatus: finalStatus },
      });
      if (cas.count !== 1) return null;

      const classification = await tx.aiClassification.create({
        data: {
          emailMessageId,
          provider,
          model,
          promptVersion: PROMPT_VERSION,
          intent: normalized.intent,
          confidence: normalized.confidence.toFixed(3),
          structuredResultJson: normalized as unknown as Prisma.InputJsonValue,
          requiresHumanReview: normalized.requiresHumanReview,
        },
      });

      await this.audit.record(
        {
          actorType: ActorType.AI,
          eventKey: finalStatus === ClassificationStatus.CLASSIFIED ? AI_AUDIT_EVENT.CLASSIFICATION_CREATED : AI_AUDIT_EVENT.HUMAN_REVIEW_REQUIRED,
          subjectType: 'AiClassification',
          subjectId: classification.id,
          metadata: {
            emailMessageId,
            intent: normalized.intent,
            confidence: normalized.confidence,
          },
        },
        tx,
      );

      // Slice G §6/§7 — the routing-action snapshot. finalStatus === HUMAN_REVIEW means the
      // classifier itself already decided; the decision is born already-complete (no worker
      // execution needed — §7). finalStatus === CLASSIFIED snapshots whatever
      // decideClassificationTimeRoutingAction() computes from RIGHT NOW's config, frozen forever.
      const routingDecision = await tx.aiRoutingDecision.create({
        data:
          finalStatus === ClassificationStatus.HUMAN_REVIEW
            ? {
                aiClassificationId: classification.id,
                renewalCaseId,
                routingVersion: AI_ROUTING_VERSION,
                action: AiRoutingAction.HUMAN_REVIEW,
                status: AiRoutingStatus.SUCCEEDED,
                resultCode: AI_ROUTING_RESULT_CODE.CLASSIFIER_REQUIRED_HUMAN_REVIEW,
                completedAt: now,
              }
            : {
                aiClassificationId: classification.id,
                renewalCaseId,
                routingVersion: AI_ROUTING_VERSION,
                action: decideClassificationTimeRoutingAction({
                  intent: normalized.intent,
                  renewalCaseId,
                  autoRouteAcceptEnabled: settings.autoRouteAcceptEnabled,
                  cutoverAt: settings.autoRouteAcceptCutoverAt,
                  now,
                  messageCreatedAt,
                  messageOccurredAt,
                }),
                status: AiRoutingStatus.PENDING,
              },
      });

      return { routingDecisionId: routingDecision.id };
    });

    return result;
  }
}
