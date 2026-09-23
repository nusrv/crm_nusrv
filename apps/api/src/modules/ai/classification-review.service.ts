import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { ActorType, ClassificationStatus } from '../../generated/prisma/enums';
import type { ClassificationReview, Prisma } from '../../generated/prisma/client';
import { AI_AUDIT_EVENT } from './ai-events.constants';
import type { CreateClassificationReviewDto } from './classification-review.dto';

const REVIEW_RESULT_SCHEMA_VERSION = 'phase3-review-v1';

export interface CreateReviewInput {
  emailMessageId: string;
  aiClassificationId: string;
  dto: CreateClassificationReviewDto;
  reviewerId: string;
}

/**
 * Slice D §18-§21 — human classification review is append-only (§19: never UPDATE, never DELETE —
 * this service only ever calls `create`), RBAC-gated at the controller (ADMIN + SALES_DEVELOPMENT),
 * and reviewer identity always comes from the authenticated request, never the request body.
 */
@Injectable()
export class ClassificationReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async createReview(input: CreateReviewInput): Promise<ClassificationReview> {
    const classification = await this.prisma.aiClassification.findUnique({
      where: { id: input.aiClassificationId },
      select: { id: true, emailMessageId: true },
    });
    if (!classification) {
      throw new NotFoundException('AiClassification not found.');
    }
    // §19 — a review must target an existing AiClassification that actually belongs to the
    // EmailMessage the request names; never allow attaching a review to another message.
    if (classification.emailMessageId !== input.emailMessageId) {
      throw new BadRequestException('This classification does not belong to the specified email message.');
    }

    const correctedResultJson: Prisma.InputJsonValue = {
      schemaVersion: REVIEW_RESULT_SCHEMA_VERSION,
      intent: input.dto.correctedIntent,
      ...(input.dto.summary !== undefined ? { summary: input.dto.summary } : {}),
      ...(input.dto.language !== undefined ? { language: input.dto.language } : {}),
    };

    return this.prisma.$transaction(async (tx) => {
      // Slice G §10 — moved to be the FIRST write in this transaction, deliberately: this is one
      // side of the closed AI-routing/human-review race. AiRoutingService's own AUTO_ACCEPT
      // transaction touches this SAME EmailMessage row as ITS first write too (a guarded, same-value
      // CAS "touch") — whichever transaction's write to this row commits first genuinely wins the
      // InnoDB row lock, and the loser's own CAS/guard naturally observes the new state and aborts
      // cleanly. See AiRoutingService's own doc comment for the other side of this race. Still
      // unconditional (not CAS-guarded by a prior-status check) — a human append always ends the
      // message at RESOLVED regardless of its prior classificationStatus, and a second review simply
      // keeps it RESOLVED.
      await tx.emailMessage.update({
        where: { id: input.emailMessageId },
        data: { classificationStatus: ClassificationStatus.RESOLVED },
      });

      const review = await tx.classificationReview.create({
        data: {
          aiClassificationId: input.aiClassificationId,
          reviewerId: input.reviewerId,
          correctedIntent: input.dto.correctedIntent,
          correctedResultJson,
          notes: input.dto.notes,
          // §20 — resultingAction is never populated in Slice D; a review never triggers execution.
          resultingAction: null,
        },
      });

      await this.audit.record(
        {
          actorType: ActorType.USER,
          actorId: input.reviewerId,
          eventKey: AI_AUDIT_EVENT.REVIEW_CREATED,
          subjectType: 'ClassificationReview',
          subjectId: review.id,
          metadata: {
            emailMessageId: input.emailMessageId,
            aiClassificationId: input.aiClassificationId,
            correctedIntent: input.dto.correctedIntent,
            reviewerId: input.reviewerId,
          },
        },
        tx,
      );

      return review;
    });
  }
}
