import { jest } from '@jest/globals';
import { ManualRenewalService } from './manual-renewal.service';

const messageId = '00000000-0000-4000-8000-000000000001';

function harness(found = true) {
  const row = { id: 'case-1', status: 'HUMAN_REVIEW', clarificationPending: false, communicationRevision: 4 };
  const update = jest.fn(() => Promise.resolve(row));
  const updateMany = jest.fn(() => Promise.resolve({ count: 1 }));
  const findFirst = jest.fn(() => Promise.resolve(found ? { id: messageId } : null));
  const tx = {
    $queryRaw: jest.fn(() => Promise.resolve([])),
    renewalCase: { findUnique: jest.fn(() => Promise.resolve(row)), update, findUniqueOrThrow: jest.fn(() => Promise.resolve(row)) },
    emailMessage: { findFirst, updateMany },
  };
  const record = jest.fn(() => Promise.resolve({ id: 'audit-1' }));
  const prisma = { $transaction: (fn: (client: typeof tx) => unknown) => Promise.resolve(fn(tx)) };
  return { service: new ManualRenewalService(prisma as never, { record } as never, {} as never), update, updateMany, findFirst, record };
}

describe('Human renewal reply review', () => {
  it('keeps the commercial case unchanged and marks only the selected inbound reply read', async () => {
    const { service, update, updateMany, record } = harness();
    await service.review('case-1', false, 'admin-1', { messageId, expectedRevision: 4 });
    expect(update).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: messageId, renewalCaseId: 'case-1', direction: 'INBOUND', reviewedAt: null },
      data: { reviewedAt: expect.any(Date), reviewedBy: 'admin-1' },
    }));
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ eventKey: 'renewal.case.kept_in_review' }), expect.anything());
  });

  it('requires the selected reply to belong to the case before changing any state', async () => {
    const { service, update, updateMany, record } = harness(false);
    await expect(service.review('case-1', true, 'admin-1', { messageId, expectedRevision: 4 })).rejects.toThrow('Inbound message not found');
    expect(update).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it('rejects a stale review before altering state or read status', async () => {
    const { service, update, updateMany } = harness();
    await expect(service.review('case-1', true, 'admin-1', { messageId, expectedRevision: 3 })).rejects.toThrow('Refresh');
    expect(update).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('requests clarification without advancing to waiting or sending mail', async () => {
    const { service, update, updateMany } = harness();
    await service.review('case-1', true, 'admin-1', { messageId, expectedRevision: 4 });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'case-1' },
      data: { status: 'HUMAN_REVIEW', customerDecision: 'UNDECIDED', clarificationPending: true, communicationRevision: { increment: 1 } },
    });
    expect(updateMany).toHaveBeenCalledTimes(1);
  });
});
