import { jest } from '@jest/globals';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { LegacyRenewalRecoveryController } from './legacy-renewal-recovery.controller';

const input = {
  periodStart: '2026-11-23',
  periodEnd: '2027-11-22',
  nextRenewalDate: '2027-11-23',
  reason: 'Recover original agreed term from archived renewal correspondence',
};
const ADMIN = { user: { id: 'admin-1' } };

function harness(overrides: Record<string, unknown> = {}, newer = false) {
  const row = {
    id: 'case-1',
    status: 'ACCEPTED',
    subscriptionId: 'sub-1',
    dueDate: new Date('2026-11-23T00:00:00.000Z'),
    proposedPeriodStart: null as Date | null,
    proposedPeriodEnd: null as Date | null,
    proposedNextRenewalDate: null as Date | null,
    ...overrides,
  };
  const updateMany = jest.fn((input: unknown) => { void input; return Promise.resolve({ count: 1 }); });
  const findFirst = jest.fn((input: unknown) => { void input; return Promise.resolve(newer ? { id: 'newer-case' } : null); });
  const tx = {
    $queryRaw: jest.fn(() => Promise.resolve([{ id: 'locked' }])),
    renewalCase: {
      findUnique: jest.fn((input: unknown) => { void input; return Promise.resolve(row); }),
      findFirst,
      updateMany,
    },
  };
  const auditRecord = jest.fn((event: unknown, client: unknown) => { void event; void client; return Promise.resolve({ id: 'audit-1' }); });
  const prisma = {
    $transaction: async <T>(callback: (t: typeof tx) => Promise<T>): Promise<T> => callback(tx),
  };
  const controller = new LegacyRenewalRecoveryController(
    prisma as never, { record: auditRecord } as never,
  );
  return { controller, row, updateMany, findFirst, auditRecord, tx };
}

describe('P1 legacy renewal proposed-date repair (OD-7)', () => {
  it('fills missing accepted-case dates and records ADMIN reason without updating subscription', async () => {
    const h = harness();
    const result = await h.controller.repair('case-1', input, ADMIN as never);
    expect(result.proposedPeriodStart.toISOString().slice(0, 10)).toBe('2026-11-23');
    expect(result.proposedNextRenewalDate.toISOString().slice(0, 10)).toBe('2027-11-23');
    expect(h.updateMany).toHaveBeenCalledTimes(1);
    const mutation = h.updateMany.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(Object.keys(mutation.data).sort()).toEqual([
      'proposedNextRenewalDate', 'proposedPeriodEnd', 'proposedPeriodStart',
    ]);
    expect(h.auditRecord).toHaveBeenCalledTimes(1);
    const event = h.auditRecord.mock.calls[0]![0] as { actorId: string; metadata: { reason: string } };
    expect(event.actorId).toBe('admin-1');
    expect(event.metadata.reason).toBe(input.reason);
  });

  it('repairs only missing fields and never overwrites matching historical dates', async () => {
    const h = harness({ proposedPeriodStart: new Date('2026-11-23') });
    await h.controller.repair('case-1', input, ADMIN as never);
    const mutation = h.updateMany.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(Object.keys(mutation.data).sort()).toEqual([
      'proposedNextRenewalDate', 'proposedPeriodEnd',
    ]);
  });

  it('rejects changes to already recorded proposed dates', async () => {
    const h = harness({ proposedPeriodStart: new Date('2026-11-24') });
    await expect(h.controller.repair('case-1', input, ADMIN as never)).rejects.toThrow(ConflictException);
    expect(h.updateMany).not.toHaveBeenCalled();
    expect(h.auditRecord).not.toHaveBeenCalled();
  });

  it('rejects non-accepted, superseded and already-complete cases', async () => {
    const notAccepted = harness({ status: 'HUMAN_REVIEW' });
    await expect(notAccepted.controller.repair('case-1', input, ADMIN as never))
      .rejects.toThrow(ConflictException);
    const newer = harness({}, true);
    await expect(newer.controller.repair('case-1', input, ADMIN as never))
      .rejects.toThrow(ConflictException);
    const complete = harness({
      proposedPeriodStart: new Date(input.periodStart),
      proposedPeriodEnd: new Date(input.periodEnd),
      proposedNextRenewalDate: new Date(input.nextRenewalDate),
    });
    await expect(complete.controller.repair('case-1', input, ADMIN as never))
      .rejects.toThrow(ConflictException);
  });

  it('rejects invalid period boundaries before attempting any database mutation', () => {
    const h = harness();
    expect(() => h.controller.repair('case-1', {
      ...input, nextRenewalDate: input.periodEnd,
    }, ADMIN as never)).toThrow(BadRequestException);
    expect(h.updateMany).not.toHaveBeenCalled();
  });
});
