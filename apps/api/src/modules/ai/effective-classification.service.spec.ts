import { jest } from '@jest/globals';
import { AiIntent } from '../../generated/prisma/enums';
import { EffectiveClassificationService } from './effective-classification.service';

describe('EffectiveClassificationService', () => {
  it('§22 Rule B — returns the latest review across ANY AiClassification of the message as effective, source HUMAN_REVIEW', async () => {
    const review = { id: 'review-1', correctedIntent: AiIntent.REJECT_RENEWAL, correctedResultJson: { intent: 'REJECT_RENEWAL' }, createdAt: new Date(), aiClassificationId: 'clf-1' };
    const findFirstReview = jest.fn(({ where }: { where: { aiClassification: { emailMessageId: string } } }) => {
      expect(where.aiClassification.emailMessageId).toBe('msg-1');
      return Promise.resolve(review);
    });
    const findFirstClassification = jest.fn();
    const prisma = { classificationReview: { findFirst: findFirstReview }, aiClassification: { findFirst: findFirstClassification } };
    const service = new EffectiveClassificationService(prisma as never);

    const result = await service.getEffectiveClassification('msg-1');

    expect(result.source).toBe('HUMAN_REVIEW');
    expect(result.effectiveIntent).toBe(AiIntent.REJECT_RENEWAL);
    expect(result.reviewId).toBe('review-1');
    expect(findFirstClassification).not.toHaveBeenCalled(); // review found -> classification lookup skipped.
  });

  it('no review -> newest AiClassification is effective, source AI', async () => {
    const findFirstReview = jest.fn(() => Promise.resolve(null));
    const classification = { id: 'clf-2', intent: AiIntent.ACCEPT_RENEWAL, structuredResultJson: { intent: 'ACCEPT_RENEWAL' }, createdAt: new Date() };
    const findFirstClassification = jest.fn(() => Promise.resolve(classification));
    const prisma = { classificationReview: { findFirst: findFirstReview }, aiClassification: { findFirst: findFirstClassification } };
    const service = new EffectiveClassificationService(prisma as never);

    const result = await service.getEffectiveClassification('msg-1');

    expect(result.source).toBe('AI');
    expect(result.effectiveIntent).toBe(AiIntent.ACCEPT_RENEWAL);
    expect(result.reviewId).toBeNull();
    expect(result.aiClassificationId).toBe('clf-2');
  });

  it('orders the review lookup by createdAt DESC, id DESC — never by aiClassificationId', async () => {
    const findFirstReview = jest.fn((_args: { orderBy: unknown[] }) => {
      void _args;
      return Promise.resolve(null);
    });
    const findFirstClassification = jest.fn((_args: { orderBy: unknown[] }) => {
      void _args;
      return Promise.resolve({ id: 'c', intent: AiIntent.OTHER, structuredResultJson: {}, createdAt: new Date() });
    });
    const prisma = { classificationReview: { findFirst: findFirstReview }, aiClassification: { findFirst: findFirstClassification } };
    const service = new EffectiveClassificationService(prisma as never);

    await service.getEffectiveClassification('msg-1');

    const reviewCall = findFirstReview.mock.calls[0]![0];
    expect(reviewCall.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    const classificationCall = findFirstClassification.mock.calls[0]![0];
    expect(classificationCall.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
  });

  it('throws NotFoundException when no classification exists at all for the message', async () => {
    const findFirstReview = jest.fn(() => Promise.resolve(null));
    const findFirstClassification = jest.fn(() => Promise.resolve(null));
    const prisma = { classificationReview: { findFirst: findFirstReview }, aiClassification: { findFirst: findFirstClassification } };
    const service = new EffectiveClassificationService(prisma as never);

    await expect(service.getEffectiveClassification('msg-1')).rejects.toThrow();
  });

  it('never returns a raw provider prompt/response — only the already-normalized result blob', async () => {
    const classification = {
      id: 'clf-1',
      intent: AiIntent.OTHER,
      structuredResultJson: { schemaVersion: 'phase3-intent-v1', intent: 'OTHER', confidence: 0.8, requiresHumanReview: false, summary: 's', language: 'en' },
      createdAt: new Date(),
    };
    const prisma = {
      classificationReview: { findFirst: jest.fn(() => Promise.resolve(null)) },
      aiClassification: { findFirst: jest.fn(() => Promise.resolve(classification)) },
    };
    const service = new EffectiveClassificationService(prisma as never);

    const result = await service.getEffectiveClassification('msg-1');

    expect(JSON.stringify(result)).not.toMatch(/prompt|apiKey|rawResponse/i);
  });
});
