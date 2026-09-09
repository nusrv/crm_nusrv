import { jest } from '@jest/globals';
import { CustomerDecision, RenewalCaseStatus } from '../../generated/prisma/enums';
import { BusinessTimeService } from '../../time/business-time.service';
import { RenewalCasesService } from './renewal-cases.service';

function businessTime() {
  return new BusinessTimeService({ getOrThrow: () => 'Asia/Amman' } as never);
}

describe('RenewalCasesService holds', () => {
  const now = new Date('2026-08-24T08:00:00.000Z');

  it('creates an expiring hold and audits its policy without changing the due date', async () => {
    const hold = {
      id: 'hold-id',
      renewalCaseId: 'case-id',
      reason: 'Awaiting customer clarification',
      stopsCustomerReminders: true,
      stopsInternalNotifications: false,
      expiresAt: new Date('2026-08-25T08:00:00.000Z'),
      active: true,
      createdById: 'actor-id',
    };
    const tx = { renewalHold: { create: jest.fn(() => Promise.resolve(hold)) } };
    const prisma = {
      renewalCase: { findUnique: jest.fn(() => Promise.resolve({ id: 'case-id' })) },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const audit = { record: jest.fn(() => Promise.resolve({ id: 'audit-id' })) };
    const service = new RenewalCasesService(
      prisma as never,
      audit as never,
      { now: () => now },
      {} as never,
    );
    const result = await service.createHold(
      'case-id',
      {
        reason: hold.reason,
        stopsCustomerReminders: true,
        stopsInternalNotifications: false,
        expiresAt: hold.expiresAt.toISOString(),
      },
      { actorId: 'actor-id' },
    );
    expect(result).toBe(hold);
    expect(JSON.stringify(tx.renewalHold.create.mock.calls)).not.toContain('dueDate');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventKey: 'renewal.hold.created' }),
      tx,
    );
  });

  it('releases an active hold with actor and timestamp audit data', async () => {
    const oldState = { id: 'hold-id', renewalCaseId: 'case-id', active: true };
    const released = { ...oldState, active: false, releasedById: 'actor-id', releasedAt: now };
    const tx = { renewalHold: { update: jest.fn(() => Promise.resolve(released)) } };
    const prisma = {
      renewalHold: { findFirst: jest.fn(() => Promise.resolve(oldState)) },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const audit = { record: jest.fn(() => Promise.resolve({ id: 'audit-id' })) };
    const service = new RenewalCasesService(
      prisma as never,
      audit as never,
      { now: () => now },
      {} as never,
    );
    expect(await service.releaseHold('case-id', 'hold-id', { actorId: 'actor-id' })).toBe(released);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventKey: 'renewal.hold.released' }),
      tx,
    );
  });

  it('rejects a hold that already expired according to the injectable clock', async () => {
    const prisma = {
      renewalCase: { findUnique: jest.fn(() => Promise.resolve({ id: 'case-id' })) },
    };
    const service = new RenewalCasesService(
      prisma as never,
      { record: jest.fn() } as never,
      { now: () => now },
      {} as never,
    );
    await expect(
      service.createHold(
        'case-id',
        {
          reason: 'Expired',
          expiresAt: '2026-08-24T07:00:00.000Z',
          stopsCustomerReminders: true,
          stopsInternalNotifications: true,
        },
        { actorId: 'actor-id' },
      ),
    ).rejects.toThrow('Hold expiration must be in the future');
  });
});

describe('RenewalCasesService.list filters', () => {
  const now = new Date('2026-08-24T08:00:00.000Z');

  it('filters by Billing Entity, package, and searches Customer Code too', async () => {
    const findMany = jest.fn<(input: { where: Record<string, unknown> }) => Promise<never[]>>(() =>
      Promise.resolve([]),
    );
    const prisma = {
      renewalCase: { findMany, count: jest.fn(() => Promise.resolve(0)) },
    };
    const service = new RenewalCasesService(
      prisma as never,
      {} as never,
      { now: () => now },
      businessTime(),
    );

    await service.list({
      page: 1,
      pageSize: 20,
      billingEntityId: 'entity-id',
      servicePackageId: 'package-id',
      search: 'FF0042',
    });

    const where = findMany.mock.calls[0]?.[0].where as { subscription: Record<string, unknown> };
    expect(where.subscription.servicePackageId).toBe('package-id');
    expect(where.subscription.customer).toEqual({ billingEntityId: 'entity-id' });
    expect(where.subscription.OR).toEqual(
      expect.arrayContaining([{ customer: { customerCode: { contains: 'FF0042' } } }]),
    );
  });
});

describe('RenewalCasesService.summary', () => {
  const now = new Date('2026-08-24T08:00:00.000Z');

  it('excludes terminal statuses from the due/overdue counts and counts AWAITING_CUSTOMER and active holds directly', async () => {
    const count = jest
      .fn<(input: { where: Record<string, unknown> }) => Promise<number>>()
      .mockResolvedValueOnce(2) // due within 7 days
      .mockResolvedValueOnce(4) // due within 30 days
      .mockResolvedValueOnce(1) // overdue
      .mockResolvedValueOnce(1) // awaiting customer
      .mockResolvedValueOnce(0); // on hold
    const prisma = { renewalCase: { count } };
    const service = new RenewalCasesService(
      prisma as never,
      {} as never,
      { now: () => now },
      businessTime(),
    );

    const result = await service.summary();

    expect(result).toEqual({
      dueWithin7Days: 2,
      dueWithin30Days: 4,
      overdue: 1,
      awaitingCustomer: 1,
      onHold: 0,
    });
    const dueWithin7Where = count.mock.calls[0]?.[0].where as {
      status: { notIn: RenewalCaseStatus[] };
    };
    expect(dueWithin7Where.status.notIn).toEqual(
      expect.arrayContaining([
        RenewalCaseStatus.CLOSED,
        RenewalCaseStatus.FULFILLED,
        RenewalCaseStatus.REJECTED,
        RenewalCaseStatus.DO_NOT_RENEW,
      ]),
    );
    const awaitingWhere = count.mock.calls[3]?.[0].where as { status: RenewalCaseStatus };
    expect(awaitingWhere.status).toBe(RenewalCaseStatus.AWAITING_CUSTOMER);
  });
});

describe('RenewalCasesService workflow actions', () => {
  const now = new Date('2026-08-24T08:00:00.000Z');

  function harness(oldStatus: RenewalCaseStatus) {
    const oldState = { id: 'case-id', status: oldStatus };
    const updated = { ...oldState };
    const tx = { renewalCase: { update: jest.fn(() => Promise.resolve(updated)) } };
    const prisma = {
      renewalCase: { findUnique: jest.fn(() => Promise.resolve(oldState)) },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const audit = { record: jest.fn(() => Promise.resolve({ id: 'audit-id' })) };
    const service = new RenewalCasesService(
      prisma as never,
      audit as never,
      { now: () => now },
      {} as never,
    );
    return { service, tx, audit };
  }

  it('marks a case Awaiting Customer from an in-flight status', async () => {
    const { service, tx, audit } = harness(RenewalCaseStatus.REMINDER_CYCLE);
    await service.markAwaitingCustomer('case-id', { actorId: 'actor-id' });
    expect(tx.renewalCase.update).toHaveBeenCalledWith({
      where: { id: 'case-id' },
      data: { status: RenewalCaseStatus.AWAITING_CUSTOMER },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventKey: 'renewal.case.marked_awaiting_customer' }),
      tx,
    );
  });

  it('marks a case Accepted and sets acceptedAt/customerDecision', async () => {
    const { service, tx } = harness(RenewalCaseStatus.AWAITING_CUSTOMER);
    await service.markAccepted('case-id', { actorId: 'actor-id' });
    expect(tx.renewalCase.update).toHaveBeenCalledWith({
      where: { id: 'case-id' },
      data: {
        status: RenewalCaseStatus.ACCEPTED,
        customerDecision: CustomerDecision.ACCEPTED,
        acceptedAt: now,
      },
    });
  });

  it('marks a case Do Not Renew and sets doNotRenewAt/customerDecision', async () => {
    const { service, tx } = harness(RenewalCaseStatus.HUMAN_REVIEW);
    await service.markDoNotRenew('case-id', { actorId: 'actor-id' });
    expect(tx.renewalCase.update).toHaveBeenCalledWith({
      where: { id: 'case-id' },
      data: {
        status: RenewalCaseStatus.DO_NOT_RENEW,
        customerDecision: CustomerDecision.REJECTED,
        doNotRenewAt: now,
      },
    });
  });

  it('marks a case Fulfilled and sets fulfilledAt', async () => {
    const { service, tx } = harness(RenewalCaseStatus.ACCEPTED);
    await service.markFulfilled('case-id', { actorId: 'actor-id' });
    expect(tx.renewalCase.update).toHaveBeenCalledWith({
      where: { id: 'case-id' },
      data: { status: RenewalCaseStatus.FULFILLED, fulfilledAt: now },
    });
  });

  it.each([
    RenewalCaseStatus.CLOSED,
    RenewalCaseStatus.FULFILLED,
    RenewalCaseStatus.REJECTED,
    RenewalCaseStatus.DO_NOT_RENEW,
  ])('refuses to transition a case that is already terminal (%s)', async (terminalStatus) => {
    const { service } = harness(terminalStatus);
    await expect(service.markAccepted('case-id', { actorId: 'actor-id' })).rejects.toThrow(
      /already .* cannot be moved/,
    );
  });
});
