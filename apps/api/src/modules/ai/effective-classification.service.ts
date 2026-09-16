import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import type { AiIntent } from '../../generated/prisma/enums';

export interface EffectiveClassificationResult {
  emailMessageId: string;
  source: 'AI' | 'HUMAN_REVIEW';
  effectiveIntent: AiIntent;
  effectiveResult: unknown;
  aiClassificationId: string;
  reviewId: string | null;
  createdAt: Date;
}

/**
 * Slice D §22 — the ONE authoritative service for "what is the effective classification of this
 * EmailMessage right now." Never duplicated elsewhere. Implements the exact frozen ordering
 * documented on ClassificationReview in schema.prisma (Rule B):
 *
 *   1. Find the newest ClassificationReview belonging to ANY AiClassification of this EmailMessage,
 *      ordered by (review.createdAt DESC, review.id DESC) — NEVER by aiClassificationId, which is
 *      an identity/grouping key, not a chronological one.
 *   2. If one exists, that human correction is effective (source: HUMAN_REVIEW).
 *   3. Otherwise, the newest AiClassification for this EmailMessage — ordered by
 *      (classification.createdAt DESC, classification.id DESC) — is effective (source: AI).
 *
 * This resolver never returns a raw provider prompt or raw provider response — only the
 * already-normalized/bounded structuredResultJson (AI) or correctedResultJson (HUMAN_REVIEW).
 */
@Injectable()
export class EffectiveClassificationService {
  constructor(private readonly prisma: PrismaService) {}

  async getEffectiveClassification(emailMessageId: string): Promise<EffectiveClassificationResult> {
    // Rule B — latest review across ALL of this message's AiClassification rows.
    const latestReview = await this.prisma.classificationReview.findFirst({
      where: { aiClassification: { emailMessageId } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        correctedIntent: true,
        correctedResultJson: true,
        createdAt: true,
        aiClassificationId: true,
      },
    });

    if (latestReview) {
      return {
        emailMessageId,
        source: 'HUMAN_REVIEW',
        effectiveIntent: latestReview.correctedIntent,
        effectiveResult: latestReview.correctedResultJson,
        aiClassificationId: latestReview.aiClassificationId,
        reviewId: latestReview.id,
        createdAt: latestReview.createdAt,
      };
    }

    // Rule (no review) — newest AiClassification for this EmailMessage.
    const latestClassification = await this.prisma.aiClassification.findFirst({
      where: { emailMessageId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true, intent: true, structuredResultJson: true, createdAt: true },
    });

    if (!latestClassification) {
      throw new NotFoundException('No classification exists for this email message.');
    }

    return {
      emailMessageId,
      source: 'AI',
      effectiveIntent: latestClassification.intent,
      effectiveResult: latestClassification.structuredResultJson,
      aiClassificationId: latestClassification.id,
      reviewId: null,
      createdAt: latestClassification.createdAt,
    };
  }
}
