import { jest } from '@jest/globals';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { acceptedRenewalPeriod, lockAcceptedRenewal } from './accepted-renewal-invoice';

const due = new Date('2026-11-23T00:00:00.000Z');
const end = new Date('2027-11-22T00:00:00.000Z');
const next = new Date('2027-11-23T00:00:00.000Z');

function accepted(overrides: Record<string, unknown> = {}) {
  return {
    id: 'renewal-1',
    subscriptionId: 'subscription-1',
    status: 'ACCEPTED',
    customerDecision: 'ACCEPTED',
    dueDate: due,
    proposedPeriodStart: due,
    proposedPeriodEnd: end,
    proposedNextRenewalDate: next,
    subscription: {
      id: 'subscription-1', renewalDate: due,
      customer: { id: 'customer-1', billingEntityId: 'issuer-1' },
    },
    ...overrides,
  };
}

function harness(row = accepted(), newer = false) {
  const findUnique = jest.fn(() => Promise.resolve(row));
  const findFirst = jest.fn(() => Promise.resolve(newer ? { id: 'renewal-2' } : null));
  const lock = jest.fn(() => Promise.resolve([{ id: 'locked' }]));
  return { tx: { $queryRaw: lock, renewalCase: { findUnique, findFirst } }, findUnique, findFirst, lock };
}

describe('P1 accepted renewal period and cycle fencing (OD-3 / OD-7 / CL-4)', () => {
  it('allows a recorded accepted cycle with a contiguous period', () => {
    expect(acceptedRenewalPeriod(accepted())).toEqual({ start: due, end, next });
  });

  it.each([
    ['not accepted', { status: 'HUMAN_REVIEW' }],
    ['customer did not accept', { customerDecision: 'UNDECIDED' }],
    ['missing dates', { proposedNextRenewalDate: null }],
    ['period begins after due date', { proposedPeriodStart: new Date('2026-11-24') }],
    ['period begins before due date', { proposedPeriodStart: new Date('2026-11-22') }],
    ['gap before next renewal', { proposedNextRenewalDate: new Date('2027-11-30') }],
    ['overlap after period end', { proposedNextRenewalDate: end }],
    ['reversed period', { proposedPeriodEnd: new Date('2026-11-22') }],
    ['invalid period timestamp', { proposedPeriodEnd: new Date(NaN) }],
  ])('rejects %s without changing subscription tracking', (_reason, changes) => {
    expect(() => acceptedRenewalPeriod(accepted(changes))).toThrow(ConflictException);
  });

  it('locks subscription and case before checking newer-cycle and tracking-date evidence', async () => {
    const h = harness();
    const result = await lockAcceptedRenewal(h.tx as never, 'renewal-1', 'subscription-1');
    expect(result.period).toEqual({ start: due, end, next });
    expect(h.lock).toHaveBeenCalledTimes(2);
    expect(h.findUnique).toHaveBeenCalledTimes(1);
    expect(h.findFirst).toHaveBeenCalledTimes(1);
  });

  it('rejects a newer cycle or an already shifted subscription renewal date', async () => {
    const newer = harness(accepted(), true);
    await expect(lockAcceptedRenewal(newer.tx as never, 'renewal-1', 'subscription-1'))
      .rejects.toThrow(ConflictException);

    const shifted = harness(accepted({
      subscription: { id: 'subscription-1', renewalDate: next, customer: { id: 'customer-1', billingEntityId: 'issuer-1' } },
    }));
    await expect(lockAcceptedRenewal(shifted.tx as never, 'renewal-1', 'subscription-1'))
      .rejects.toThrow(ConflictException);
  });

  it('rejects a case that belongs to a different subscription', async () => {
    const h = harness(accepted({ subscriptionId: 'another-subscription' }));
    await expect(lockAcceptedRenewal(h.tx as never, 'renewal-1', 'subscription-1'))
      .rejects.toThrow(NotFoundException);
  });
});
