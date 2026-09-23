import { Inject, Injectable, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { AuditService } from '../../audit/audit.service';
import { PrismaService } from '../../database/prisma.service';
import { ActorType, HealthStatus, MessageDirection } from '../../generated/prisma/enums';
import { AiSettingsResolverService } from '../ai/ai-settings-resolver.service';
import { MAX_HISTORY_MESSAGES } from '../ai/ai-context.util';
import { buildDraftReplyInput } from '../ai/ai-draft-context.util';
import { AiHealthService } from '../ai/ai-health.service';
import { AI_AUDIT_EVENT } from '../ai/ai-events.constants';
import { EffectiveClassificationService } from '../ai/effective-classification.service';
import { LLM_GATEWAY } from '../ai/llm-gateway';
import type { LlmGateway } from '../ai/llm-gateway';
import { LlmMalformedOutputError, LlmPermanentError, LlmTransientError } from '../ai/llm-errors';
import { normalizeReplySubject } from './reply-threading.util';

function sanitizeError(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 1000);
  return 'Unknown AI drafting error.';
}

export interface DraftReplyResult {
  subject: string;
  bodyText: string;
  language: string;
  schemaVersion: string;
}

/**
 * Slice F §15 — the ONE service that generates a suggested reply draft. Strictly read-only /
 * side-effect-free with respect to business state: it never calls OperatorReplyService, never
 * touches OperatorReplyOutbox, never calls a MailTransport, never mutates RenewalCase or
 * Subscription, and never performs a payment/invoice action. Its only side effects are a safe audit
 * event and (via the shared AiHealthService) the existing AI health domain — nothing else.
 *
 * §4/§24 — ephemeral by design: the generated draft is returned to the caller and never persisted
 * anywhere. No AiReplyDraft table, no draft EmailMessage row, no schema change.
 */
@Injectable()
export class AiReplyDraftService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiSettings: AiSettingsResolverService,
    private readonly audit: AuditService,
    private readonly health: AiHealthService,
    private readonly effectiveClassification: EffectiveClassificationService,
    @Inject(LLM_GATEWAY) private readonly gateway: LlmGateway,
  ) {}

  async generateDraft(threadId: string, actorId: string): Promise<DraftReplyResult> {
    // §6 / Phase 3.1 §J correction — AI disabled fails safely, with zero provider calls and zero
    // mutation, resolved from AiSettings (never AI_ENABLED — see DynamicLlmGateway's own identical
    // check, which this pre-check simply short-circuits before doing any DB reads below). Never
    // falls back to MockLlmGateway "as if AI worked."
    const settings = await this.aiSettings.getSettings();
    if (!settings.enabled) {
      throw new UnprocessableEntityException('AI_ASSISTANCE_DISABLED');
    }

    const thread = await this.prisma.communicationThread.findUnique({
      where: { id: threadId },
      select: {
        id: true,
        subject: true,
        customerId: true,
        renewalCaseId: true,
        customer: { select: { customerCode: true, nameEn: true, nameAr: true, preferredLanguage: true } },
        renewalCase: {
          select: { status: true, dueDate: true, subscription: { select: { subscriptionCode: true, name: true } } },
        },
      },
    });
    if (!thread) throw new NotFoundException('Communication thread not found.');

    // §7 — the latest INBOUND EmailMessage in this thread only, ordered (occurredAt DESC, id DESC).
    // A thread with no inbound message at all (outbound-only) never generates a draft.
    const currentMessage = await this.prisma.emailMessage.findFirst({
      where: { threadId, direction: MessageDirection.INBOUND },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      select: { id: true, subject: true, bodyText: true, occurredAt: true },
    });
    if (!currentMessage) {
      throw new UnprocessableEntityException('NO_INBOUND_MESSAGE_TO_REPLY_TO');
    }

    const priorMessages = await this.loadPriorMessages(threadId, currentMessage.id, currentMessage.occurredAt);

    // §8 — the one authoritative effective-classification lookup (human review wins over AI per
    // Slice D's frozen ordering). Absence is a legitimate, expected state (e.g. a still-PENDING
    // message) — never fabricated, the prompt simply omits classification context entirely.
    const effective = await this.effectiveClassification.getEffectiveClassification(currentMessage.id).catch(() => null);

    const draftInput = buildDraftReplyInput(
      { subject: currentMessage.subject, bodyText: currentMessage.bodyText, occurredAt: currentMessage.occurredAt },
      priorMessages,
      effective
        ? {
            source: effective.source,
            intent: effective.effectiveIntent,
            summary: readSafeStringField(effective.effectiveResult, 'summary') ?? '',
            language: readSafeStringField(effective.effectiveResult, 'language') ?? 'en',
          }
        : null,
      thread.customer
        ? {
            customerCode: thread.customer.customerCode,
            nameEn: thread.customer.nameEn,
            nameAr: thread.customer.nameAr,
            preferredLanguage: thread.customer.preferredLanguage,
          }
        : null,
      thread.renewalCase
        ? {
            renewalCaseStatus: thread.renewalCase.status,
            dueDate: thread.renewalCase.dueDate,
            subscriptionCode: thread.renewalCase.subscription.subscriptionCode,
            serviceName: thread.renewalCase.subscription.name,
          }
        : null,
    );

    let normalized: Awaited<ReturnType<LlmGateway['draftReply']>>;
    try {
      normalized = await this.gateway.draftReply(draftInput);
    } catch (error) {
      throw await this.handleDraftFailure(error);
    }

    // Mirrors AiClassificationService's own post-success health bookkeeping — the shared AI health
    // domain is never duplicated (§18).
    await this.health.record(HealthStatus.HEALTHY, 'AI provider call succeeded.');

    // settings.enabled was already confirmed true above, and DynamicLlmGateway would have thrown
    // LlmPermanentError (caught above) had provider/model/key been anything other than a fully
    // configured real OpenAI setup — so reaching this line means exactly that ran.
    const provider = settings.provider;
    const model = settings.model ?? 'unknown';

    // §17 — safe metadata only. Never the generated bodyText, never the customer's bodyText, never
    // the prompt, never the raw provider response.
    await this.audit.record({
      actorType: ActorType.USER,
      actorId,
      eventKey: AI_AUDIT_EVENT.REPLY_DRAFT_GENERATED,
      subjectType: 'CommunicationThread',
      subjectId: threadId,
      metadata: {
        threadId,
        sourceEmailMessageId: currentMessage.id,
        customerId: thread.customerId,
        renewalCaseId: thread.renewalCaseId,
        provider,
        model,
        schemaVersion: normalized.schemaVersion,
        language: normalized.language,
      },
    });

    return {
      // §11 — deterministic only, never AI-generated. Reuses the exact same utility
      // OperatorReplyService uses so the subject-aware idempotency contract is never at risk.
      subject: normalizeReplySubject(thread.subject),
      bodyText: normalized.bodyText,
      language: normalized.language,
      schemaVersion: normalized.schemaVersion,
    };
  }

  /** Mirrors AiClassificationService.loadPriorMessages exactly (bounded, chronological, oldest
   * first, bodyText/subject/direction/occurredAt only) — never reimplemented differently. */
  private async loadPriorMessages(threadId: string, currentMessageId: string, currentOccurredAt: Date) {
    const rows = await this.prisma.emailMessage.findMany({
      where: { threadId, id: { not: currentMessageId }, occurredAt: { lt: currentOccurredAt } },
      orderBy: { occurredAt: 'desc' },
      take: MAX_HISTORY_MESSAGES,
      select: { subject: true, bodyText: true, direction: true, occurredAt: true },
    });
    return rows.reverse();
  }

  /** Mirrors AiClassificationService.handleClassificationFailure's exact error-to-health mapping
   * (§18): transient → DEGRADED, permanent/auth/config → UNAVAILABLE, malformed output → a
   * message-level failure only, never concluding the whole provider is unavailable. Always returns
   * (never throws) a safe, operator-facing exception — the raw provider error/response never
   * crosses this boundary. */
  private async handleDraftFailure(error: unknown): Promise<Error> {
    if (error instanceof LlmTransientError) {
      await this.health.record(HealthStatus.DEGRADED, sanitizeError(error));
      return new ServiceUnavailableException('AI_ASSISTANCE_TEMPORARILY_UNAVAILABLE');
    }
    if (error instanceof LlmPermanentError) {
      await this.health.record(HealthStatus.UNAVAILABLE, sanitizeError(error));
      return new ServiceUnavailableException('AI_ASSISTANCE_UNAVAILABLE');
    }
    if (error instanceof LlmMalformedOutputError) {
      return new UnprocessableEntityException('AI_DRAFT_GENERATION_FAILED');
    }
    await this.health.record(HealthStatus.DEGRADED, sanitizeError(error));
    return new ServiceUnavailableException('AI_ASSISTANCE_TEMPORARILY_UNAVAILABLE');
  }
}

/** Defensive narrow-read of the polymorphic effectiveResult JSON blob (AiClassification's
 * structuredResultJson shape OR ClassificationReview's correctedResultJson shape) — never assumes
 * either shape, never throws on an unexpected value. */
function readSafeStringField(value: unknown, field: string): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const raw = (value as Record<string, unknown>)[field];
  return typeof raw === 'string' ? raw : undefined;
}
