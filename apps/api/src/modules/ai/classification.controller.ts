import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import type { AuthenticatedRequest } from '../../identity/auth-user';
import { Roles } from '../../identity/roles.decorator';
import { ClassificationReviewService } from './classification-review.service';
import { CreateClassificationReviewDto } from './classification-review.dto';
import { EffectiveClassificationService } from './effective-classification.service';

/**
 * Slice D §24 — minimal backend API only, no frontend. Read (classification history/effective
 * result) uses this repository's existing "any authenticated internal user may read" pattern
 * (mirrors CustomersController's GET endpoints — no extra @Roles), never made public. Review
 * creation is restricted to ADMIN + SALES_DEVELOPMENT (§18). No raw prompt, raw provider response,
 * or credential is ever returned by any endpoint here.
 */
@Controller('email-messages/:emailMessageId')
export class ClassificationController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly effectiveClassification: EffectiveClassificationService,
    private readonly reviews: ClassificationReviewService,
  ) {}

  @Get('classification')
  async getClassification(@Param('emailMessageId') emailMessageId: string) {
    const [classifications, effective] = await Promise.all([
      this.prisma.aiClassification.findMany({
        where: { emailMessageId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          provider: true,
          model: true,
          promptVersion: true,
          intent: true,
          confidence: true,
          requiresHumanReview: true,
          structuredResultJson: true,
          createdAt: true,
          reviews: {
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            select: {
              id: true,
              reviewerId: true,
              correctedIntent: true,
              correctedResultJson: true,
              notes: true,
              createdAt: true,
            },
          },
        },
      }),
      this.effectiveClassification.getEffectiveClassification(emailMessageId).catch(() => null),
    ]);

    return { emailMessageId, effective, classifications };
  }

  @Roles('ADMIN', 'SALES_DEVELOPMENT')
  @Post('classifications/:classificationId/reviews')
  async createReview(
    @Param('emailMessageId') emailMessageId: string,
    @Param('classificationId') classificationId: string,
    @Body() dto: CreateClassificationReviewDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.reviews.createReview({
      emailMessageId,
      aiClassificationId: classificationId,
      dto,
      // §18 — reviewer identity comes from authenticated user context only, never the request body.
      reviewerId: request.user.id,
    });
  }
}
