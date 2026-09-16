import { Injectable } from '@nestjs/common';
import { AiIntent } from '../../generated/prisma/enums';
import type { ClassificationInput, LlmGateway, NormalizedClassificationResult } from './llm-gateway';
import { RESULT_SCHEMA_VERSION } from './llm-gateway';

/**
 * Slice D §26 — deterministic, network-free. Never decrypts/reads a real API credential (it has no
 * access to one at all — its constructor takes nothing). The default behavior is a simple,
 * deterministic keyword classifier over the current message's body text, useful as an actual
 * AI_PROVIDER=mock experience in non-production environments; `classifyIntentImpl` is a public,
 * overridable test seam (mirrors SmtpMailTransport.transportFactory / ImapMailboxReader.clientFactory
 * — the established pattern for substituting behavior without module-level mocking) for exercising
 * every scenario Slice D's test matrix needs (high/low confidence, UNCLEAR, provider-requested
 * review, transient/permanent failure, malformed output, delayed/concurrent responses).
 */
@Injectable()
export class MockLlmGateway implements LlmGateway {
  classifyIntentImpl: (input: ClassificationInput) => Promise<NormalizedClassificationResult> = (input) =>
    Promise.resolve(defaultKeywordClassification(input));

  classifyIntent(input: ClassificationInput): Promise<NormalizedClassificationResult> {
    return this.classifyIntentImpl(input);
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
