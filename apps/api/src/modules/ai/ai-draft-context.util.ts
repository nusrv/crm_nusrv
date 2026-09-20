import type { DraftContextMessage, DraftCustomerContext, DraftEffectiveClassificationContext, DraftRenewalContext, DraftReplyInput } from './llm-gateway';
import {
  MAX_AI_LANGUAGE_LENGTH,
  MAX_AI_SUMMARY_LENGTH,
  MAX_CURRENT_BODY_CHARS,
  MAX_HISTORY_BODY_CHARS_EACH,
  MAX_HISTORY_MESSAGES,
  MAX_SUBJECT_CHARS,
  truncateChars,
} from './ai-context.util';

/**
 * Slice F §9/§12 — every bound on what gets sent to (or accepted back from) the drafting model,
 * centralized in one place, mirroring ai-context.util.ts's own rationale exactly. Reuses Slice D's
 * message-context bounds unchanged (MAX_CURRENT_BODY_CHARS / MAX_HISTORY_MESSAGES /
 * MAX_HISTORY_BODY_CHARS_EACH / MAX_SUBJECT_CHARS) — a suggested-reply draft needs exactly the same
 * amount of thread context a classification does, no more.
 */
export const MAX_DRAFT_CUSTOMER_NAME_CHARS = 255;
export const MAX_DRAFT_CUSTOMER_CODE_CHARS = 50;
export const MAX_DRAFT_SUBSCRIPTION_CODE_CHARS = 100;
export const MAX_DRAFT_SERVICE_NAME_CHARS = 255;
export const MAX_DRAFT_RENEWAL_STATUS_CHARS = 50;

/** Ceiling on the generated bodyText itself (accepted back from the provider) — generous for a
 * multi-paragraph professional reply, never unbounded. */
export const MAX_DRAFT_BODY_CHARS = 6_000;

/** Documented ceiling on the combined size of everything sent to the provider for one draft
 * request — an explicit, tested invariant, exactly mirroring MAX_TOTAL_CONTEXT_CHARS's rationale. */
export const MAX_DRAFT_TOTAL_CONTEXT_CHARS = 24_000;

export interface DraftContextMessageSource {
  subject: string;
  bodyText: string;
  direction: 'INBOUND' | 'OUTBOUND';
  occurredAt: Date;
}

export interface DraftCurrentMessageSource {
  subject: string;
  bodyText: string;
  occurredAt: Date;
}

export interface DraftEffectiveClassificationSource {
  source: 'AI' | 'HUMAN_REVIEW';
  intent: string;
  summary: string;
  language: string;
}

export interface DraftCustomerSource {
  customerCode: string;
  nameEn: string | null;
  nameAr: string | null;
  preferredLanguage: string;
}

export interface DraftRenewalSource {
  renewalCaseStatus: string;
  dueDate: Date;
  subscriptionCode: string;
  serviceName: string | null;
}

/**
 * Builds the bounded DraftReplyInput from already-loaded, already-authorized rows. This function
 * only truncates/shapes — it never queries the database and never decides eligibility (that is
 * AiReplyDraftService's job, per §7/§8: latest INBOUND message selection, effective-classification
 * lookup via the one authoritative EffectiveClassificationService).
 */
export function buildDraftReplyInput(
  current: DraftCurrentMessageSource,
  priorMessages: DraftContextMessageSource[],
  effectiveClassification: DraftEffectiveClassificationSource | null,
  customer: DraftCustomerSource | null,
  renewal: DraftRenewalSource | null,
): DraftReplyInput {
  const boundedPriorMessages: DraftContextMessage[] = priorMessages.slice(-MAX_HISTORY_MESSAGES).map((message) => ({
    subject: truncateChars(message.subject, MAX_SUBJECT_CHARS),
    bodyText: truncateChars(message.bodyText, MAX_HISTORY_BODY_CHARS_EACH),
    direction: message.direction,
    occurredAt: message.occurredAt,
  }));

  const boundedEffectiveClassification: DraftEffectiveClassificationContext | null = effectiveClassification
    ? {
        source: effectiveClassification.source,
        intent: effectiveClassification.intent,
        summary: truncateChars(effectiveClassification.summary, MAX_AI_SUMMARY_LENGTH),
        language: truncateChars(effectiveClassification.language, MAX_AI_LANGUAGE_LENGTH),
      }
    : null;

  const boundedCustomer: DraftCustomerContext | null = customer
    ? {
        customerCode: truncateChars(customer.customerCode, MAX_DRAFT_CUSTOMER_CODE_CHARS),
        nameEn: customer.nameEn ? truncateChars(customer.nameEn, MAX_DRAFT_CUSTOMER_NAME_CHARS) : null,
        nameAr: customer.nameAr ? truncateChars(customer.nameAr, MAX_DRAFT_CUSTOMER_NAME_CHARS) : null,
        preferredLanguage: truncateChars(customer.preferredLanguage, MAX_AI_LANGUAGE_LENGTH),
      }
    : null;

  const boundedRenewal: DraftRenewalContext | null = renewal
    ? {
        renewalCaseStatus: truncateChars(renewal.renewalCaseStatus, MAX_DRAFT_RENEWAL_STATUS_CHARS),
        dueDate: renewal.dueDate,
        subscriptionCode: truncateChars(renewal.subscriptionCode, MAX_DRAFT_SUBSCRIPTION_CODE_CHARS),
        serviceName: renewal.serviceName ? truncateChars(renewal.serviceName, MAX_DRAFT_SERVICE_NAME_CHARS) : null,
      }
    : null;

  return {
    current: {
      subject: truncateChars(current.subject, MAX_SUBJECT_CHARS),
      bodyText: truncateChars(current.bodyText, MAX_CURRENT_BODY_CHARS),
      occurredAt: current.occurredAt,
    },
    priorMessages: boundedPriorMessages,
    effectiveClassification: boundedEffectiveClassification,
    customer: boundedCustomer,
    renewal: boundedRenewal,
  };
}

/** Total character budget actually used by one built draft input — a test-facing invariant check,
 * mirroring totalContextChars in ai-context.util.ts. Not used by production code. */
export function totalDraftContextChars(input: DraftReplyInput): number {
  const historyChars = input.priorMessages.reduce((sum, message) => sum + message.subject.length + message.bodyText.length, 0);
  const classificationChars = input.effectiveClassification
    ? input.effectiveClassification.summary.length + input.effectiveClassification.language.length + input.effectiveClassification.intent.length
    : 0;
  const customerChars = input.customer
    ? input.customer.customerCode.length + (input.customer.nameEn?.length ?? 0) + (input.customer.nameAr?.length ?? 0)
    : 0;
  const renewalChars = input.renewal
    ? input.renewal.renewalCaseStatus.length + input.renewal.subscriptionCode.length + (input.renewal.serviceName?.length ?? 0)
    : 0;
  return input.current.subject.length + input.current.bodyText.length + historyChars + classificationChars + customerChars + renewalChars;
}
