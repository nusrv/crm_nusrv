import { jest } from '@jest/globals';
import { AiIntent, ClassificationStatus } from '../../generated/prisma/enums';
import { ClassificationReviewService } from './classification-review.service';
import { AI_AUDIT_EVENT } from './ai-events.constants';

function harness(classification: { id: string; emailMessageId: string } | null) {
  const findUnique = jest.fn(() => Promise.resolve(classification));
  const create = jest.fn((args: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: 'review-1', createdAt: new Date(), ...args.data }),
  );
  const emailMessageUpdate = jest.fn((args: { where: { id: string }; data: Record<string, unknown> }) => {
    void args;
    return Promise.resolve({});
  });
  const auditRecord = jest.fn((event: { eventKey: string; metadata?: Record<string, unknown> }) => {
    void event;
    return Promise.resolve();
  });
  const tx = {
    classificationReview: { create },
    emailMessage: { update: emailMessageUpdate },
  };
  const prisma = {
    aiClassification: { findUnique },
    $transaction: jest.fn((cb: (tx: unknown) => unknown) => Promise.resolve(cb(tx))),
  };
  const audit = { record: auditRecord };
  const service = new ClassificationReviewService(prisma as never, audit as never);
  return { service, findUnique, create, emailMessageUpdate, auditRecord };
}

describe('ClassificationReviewService', () => {
  it('§19 — creates a review when the classification belongs to the expected email message', async () => {
    const { service, create, emailMessageUpdate, auditRecord } = harness({ id: 'clf-1', emailMessageId: 'msg-1' });

    const review = await service.createReview({
      emailMessageId: 'msg-1',
      aiClassificationId: 'clf-1',
      dto: { correctedIntent: AiIntent.REJECT_RENEWAL, summary: 'Customer actually declined.' },
      reviewerId: 'user-1',
    });

    expect(review.id).toBe('review-1');
    const createCall = create.mock.calls[0]![0];
    expect(createCall.data).toMatchObject({
      aiClassificationId: 'clf-1',
      reviewerId: 'user-1',
      correctedIntent: AiIntent.REJECT_RENEWAL,
      resultingAction: null, // §20 — never populated in Slice D.
    });
    // §21 — EmailMessage.classificationStatus -> RESOLVED.
    expect(emailMessageUpdate).toHaveBeenCalledWith({
      where: { id: 'msg-1' },
      data: { classificationStatus: ClassificationStatus.RESOLVED },
    });
    const auditCall = auditRecord.mock.calls[0]!;
    expect(auditCall[0].eventKey).toBe(AI_AUDIT_EVENT.REVIEW_CREATED);
    expect(auditCall[0].metadata).toMatchObject({ reviewerId: 'user-1' });
  });

  it('§19 — rejects a review whose classification belongs to a DIFFERENT email message', async () => {
    const { service, create } = harness({ id: 'clf-1', emailMessageId: 'msg-OTHER' });

    await expect(
      service.createReview({
        emailMessageId: 'msg-1',
        aiClassificationId: 'clf-1',
        dto: { correctedIntent: AiIntent.REJECT_RENEWAL },
        reviewerId: 'user-1',
      }),
    ).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });

  it('throws when the referenced AiClassification does not exist', async () => {
    const { service } = harness(null);
    await expect(
      service.createReview({
        emailMessageId: 'msg-1',
        aiClassificationId: 'nonexistent',
        dto: { correctedIntent: AiIntent.REJECT_RENEWAL },
        reviewerId: 'user-1',
      }),
    ).rejects.toThrow();
  });

  it('§20 — never accepts/persists a resultingAction from the caller (DTO has no such field)', async () => {
    const { service, create } = harness({ id: 'clf-1', emailMessageId: 'msg-1' });
    await service.createReview({
      emailMessageId: 'msg-1',
      aiClassificationId: 'clf-1',
      dto: { correctedIntent: AiIntent.ACCEPT_RENEWAL },
      reviewerId: 'user-1',
    });
    const call = create.mock.calls[0]![0] as { data: { resultingAction: unknown } };
    expect(call.data.resultingAction).toBeNull();
  });

  it('§20 — correctedResultJson is always server-reconstructed from whitelisted fields only, never an arbitrary client blob', async () => {
    const { service, create } = harness({ id: 'clf-1', emailMessageId: 'msg-1' });
    await service.createReview({
      emailMessageId: 'msg-1',
      aiClassificationId: 'clf-1',
      dto: { correctedIntent: AiIntent.ACCEPT_RENEWAL, summary: 'ok', language: 'en' },
      reviewerId: 'user-1',
    });
    const call = create.mock.calls[0]![0] as { data: { correctedResultJson: Record<string, unknown> } };
    expect(Object.keys(call.data.correctedResultJson).sort()).toEqual(['intent', 'language', 'schemaVersion', 'summary']);
  });
});
