import { Injectable } from '@nestjs/common';
import { AiIntent } from '../../generated/prisma/enums';
import type { ClassificationInput, DraftReplyInput, LlmGateway, NormalizedClassificationResult, NormalizedDraftResult } from './llm-gateway';
import { DRAFT_RESULT_SCHEMA_VERSION, RESULT_SCHEMA_VERSION } from './llm-gateway';

/**
 * Slice D §26 — deterministic, network-free. Never decrypts/reads a real API credential (it has no
 * access to one at all — its constructor takes nothing). The default behavior is a simple,
 * deterministic keyword classifier over the current message's body text, useful as an actual
 * AI_PROVIDER=mock experience in non-production environments; `classifyIntentImpl` is a public,
 * overridable test seam (mirrors SmtpMailTransport.transportFactory / ImapMailboxReader.clientFactory
 * — the established pattern for substituting behavior without module-level mocking) for exercising
 * every scenario Slice D's test matrix needs (high/low confidence, UNCLEAR, provider-requested
 * review, transient/permanent failure, malformed output, delayed/concurrent responses).
 *
 * Slice F — `draftReplyImpl` is the identical test seam pattern for suggested-reply drafting,
 * entirely independent of classifyIntentImpl/classifyIntent above.
 */
@Injectable()
export class MockLlmGateway implements LlmGateway {
  classifyIntentImpl: (input: ClassificationInput) => Promise<NormalizedClassificationResult> = (input) =>
    Promise.resolve(defaultKeywordClassification(input));

  classifyIntent(input: ClassificationInput): Promise<NormalizedClassificationResult> {
    return this.classifyIntentImpl(input);
  }

  draftReplyImpl: (input: DraftReplyInput) => Promise<NormalizedDraftResult> = (input) =>
    Promise.resolve(defaultDraftReply(input));

  draftReply(input: DraftReplyInput): Promise<NormalizedDraftResult> {
    return this.draftReplyImpl(input);
  }
}

/** Simple heuristic: any Arabic-script codepoint present means "write the draft in Arabic." Never
 * used for anything beyond this mock's own deterministic fallback. */
function looksArabic(text: string): boolean {
  return /[؀-ۿ]/.test(text);
}

function resolveDraftLanguage(input: DraftReplyInput): string {
  if (input.effectiveClassification?.language) return input.effectiveClassification.language;
  if (looksArabic(input.current.bodyText)) return 'ar';
  if (input.customer?.preferredLanguage) return input.customer.preferredLanguage;
  return 'en';
}

/**
 * Slice F §14/§20 — deterministic, network-free, and deliberately conservative about the exact
 * same commercial/payment claims the real system prompt (ai-draft-prompt.ts) forbids: a reported
 * payment is only ever acknowledged, never confirmed as received; an invoice request is only ever
 * acknowledged as being processed, never claimed as already issued/sent; no price is ever invented;
 * no renewal/cancellation/suspension is ever claimed as already completed.
 */
function defaultDraftReply(input: DraftReplyInput): NormalizedDraftResult {
  const language = resolveDraftLanguage(input);
  const intent = input.effectiveClassification?.intent ?? null;
  const isArabic = language.toLowerCase().startsWith('ar');

  const bodyText = isArabic ? arabicDraftFor(intent) : englishDraftFor(intent);

  return { schemaVersion: DRAFT_RESULT_SCHEMA_VERSION, bodyText, language };
}

function englishDraftFor(intent: string | null): string {
  switch (intent) {
    case AiIntent.REQUEST_INVOICE:
      return 'Thank you for your message. We have received your invoice request and it will be reviewed and processed by our team shortly.';
    case AiIntent.PAYMENT_REPORTED:
      return 'Thank you for informing us about your payment. Our team will verify this and follow up with you shortly.';
    case AiIntent.PRICE_DISPUTE:
      return 'Thank you for sharing your concern about pricing. A member of our team will review your account and get back to you.';
    case AiIntent.COMPLAINT:
      return "We are sorry to hear about your experience. We take this seriously and a member of our team will follow up with you shortly.";
    case AiIntent.ACCEPT_RENEWAL:
      return 'Thank you for confirming. Our team will follow up with the next steps for your renewal shortly.';
    case AiIntent.REJECT_RENEWAL:
      return 'Thank you for letting us know. A member of our team will follow up with you regarding your account shortly.';
    default:
      return 'Thank you for your message. A member of our team will review it and follow up with you shortly.';
  }
}

function arabicDraftFor(intent: string | null): string {
  switch (intent) {
    case AiIntent.REQUEST_INVOICE:
      return 'شكرًا لتواصلكم. لقد استلمنا طلبكم الخاص بالفاتورة وسيتم مراجعته ومعالجته من قبل فريقنا قريبًا.';
    case AiIntent.PAYMENT_REPORTED:
      return 'شكرًا لإبلاغنا بالدفعة. سيقوم فريقنا بالتحقق من ذلك والتواصل معكم قريبًا.';
    case AiIntent.PRICE_DISPUTE:
      return 'شكرًا لمشاركتنا استفساركم بخصوص السعر. سيقوم أحد أعضاء فريقنا بمراجعة حسابكم والرد عليكم.';
    case AiIntent.COMPLAINT:
      return 'يؤسفنا سماع ذلك. نأخذ الأمر على محمل الجد وسيتواصل معكم أحد أعضاء فريقنا قريبًا.';
    case AiIntent.ACCEPT_RENEWAL:
      return 'شكرًا لتأكيدكم. سيتواصل معكم فريقنا بخصوص الخطوات التالية للتجديد قريبًا.';
    case AiIntent.REJECT_RENEWAL:
      return 'شكرًا لإعلامنا. سيتواصل معكم أحد أعضاء فريقنا بخصوص حسابكم قريبًا.';
    default:
      return 'شكرًا لرسالتكم. سيقوم أحد أعضاء فريقنا بمراجعتها والتواصل معكم قريبًا.';
  }
}

function defaultKeywordClassification(input: ClassificationInput): NormalizedClassificationResult {
  const text = input.current.bodyText.toLowerCase();
  const result = (intent: AiIntent, confidence: number, requiresHumanReview = false): NormalizedClassificationResult => ({
    schemaVersion: RESULT_SCHEMA_VERSION,
    intent,
    confidence,
    requiresHumanReview,
    summary: `Deterministic mock classification for a message containing ${input.current.bodyText.length} characters.`,
    language: 'en',
  });

  if (/\b(already paid|i paid|payment sent|paid it)\b/.test(text)) return result(AiIntent.PAYMENT_REPORTED, 0.95);
  if (/\b(invoice please|send.*invoice|request.*invoice)\b/.test(text)) return result(AiIntent.REQUEST_INVOICE, 0.93);
  if (/\b(no thanks|not renewing|do not renew|reject|cancel)\b/.test(text)) return result(AiIntent.REJECT_RENEWAL, 0.95);
  if (/\b(yes|please do|go ahead|confirmed|accept)\b/.test(text)) return result(AiIntent.ACCEPT_RENEWAL, 0.96);
  if (/\b(too expensive|price is high|discount)\b/.test(text)) return result(AiIntent.PRICE_DISPUTE, 0.9);
  if (/\b(upgrade|more storage|bigger plan)\b/.test(text)) return result(AiIntent.REQUEST_UPGRADE, 0.9);
  if (/\b(downgrade|smaller plan|reduce)\b/.test(text)) return result(AiIntent.REQUEST_DOWNGRADE, 0.9);
  if (/\b(unhappy|complaint|not satisfied|angry)\b/.test(text)) return result(AiIntent.COMPLAINT, 0.9);
  if (!text.trim()) return result(AiIntent.UNCLEAR, 0.99, true);
  return result(AiIntent.OTHER, 0.85);
}
