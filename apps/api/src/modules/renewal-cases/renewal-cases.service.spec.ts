import { jest } from '@jest/globals';
import { ConflictException } from '@nestjs/common';
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

describe('RenewalCasesService workflow actions — accepted prospective policy', () => {
  const now = new Date('2026-08-24T08:00:00.000Z');
  const due = new Date('2026-08-24T00:00:00.000Z');
  const end = new Date('2027-08-23T00:00:00.000Z');
  const next = new Date('2027-08-24T00:00:00.000Z');
  const graphicalQr =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';

  function harness(
    oldStatus: RenewalCaseStatus,
    options: { updateManyCount?: number; withOfficialInvoice?: boolean } = {},
  ) {
    const subscription = {
      id: 'subscription-id',
      customerId: 'customer-id',
      renewalDate: due,
      renewalIntervalMonths: 12,
      customer: { id: 'customer-id', billingEntityId: 'issuer-id' },
    };
    const oldState = {
      id: 'case-id',
      status: oldStatus,
      subscriptionId: 'subscription-id',
      dueDate: due,
      subscription,
      clarificationPending: false,
      communicationRevision: 0,
      customerDecision: oldStatus === RenewalCaseStatus.ACCEPTED
        ? CustomerDecision.ACCEPTED : CustomerDecision.UNDECIDED,
      proposedPeriodStart: oldStatus === RenewalCaseStatus.ACCEPTED ? due : null,
      proposedPeriodEnd: oldStatus === RenewalCaseStatus.ACCEPTED ? end : null,
      proposedNextRenewalDate: oldStatus === RenewalCaseStatus.ACCEPTED ? next : null,
    };
    let latestStatus = oldStatus;
    const updateMany = jest.fn(({ data }: { data: { status: RenewalCaseStatus } }) => {
      if (options.updateManyCount === 0) return Promise.resolve({ count: 0 });
      latestStatus = data.status;
      return Promise.resolve({ count: 1 });
    });
    const official = options.withOfficialInvoice ? {
      id: 'official-invoice-id',
      status: 'FAWTARA_ACCEPTED',
      submissionLock: null,
      officializationProvenance: 'MANUAL',
      fawtaraStatus: 'SUBMITTED',
      fawtaraInvoiceNumber: 'OFFICIAL-2026-001',
      fawtaraAcceptedAt: new Date('2026-08-24T08:00:00.000Z'),
      fawtaraQrImageDataUrl: graphicalQr,
      officialCurrencyCode: 'JOD',
      officialGrandTotal: { toString: () => '100.000' },
      billingEntityId: 'issuer-id',
      issuerLegalNameSnapshot: 'NUSRV',
      sourceRenewalCaseId: 'case-id',
      sourceSubscriptionId: 'subscription-id',
      customerId: 'customer-id',
      periodStart: due,
      periodEnd: end,
    } : null;
    const tx = {
      $queryRaw: jest.fn(async (_strings: TemplateStringsArray, ..._values: unknown[]) => [{ id: 'locked' }]),
      renewalCase: {
        updateMany,
        findUnique: jest.fn(async () => ({ ...oldState, status: latestStatus })),
        findFirst: jest.fn(async () => null),
        findUniqueOrThrow: jest.fn(async () => ({ ...oldState, status: latestStatus })),
      },
      invoice: { findUnique: jest.fn(async () => official) },
      subscription: { updateMany: jest.fn(async () => ({ count: 1 })) },
    };
    const prisma = {
      renewalCase: { findUnique: jest.fn(async () => oldState) },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const audit = {
      record: jest.fn<
        (input: { oldState: { status: RenewalCaseStatus }; newState: { status: RenewalCaseStatus } }) => Promise<{ id: string }>
      >(() => Promise.resolve({ id: 'audit-id' })),
    };
    const service = new RenewalCasesService(
      prisma as never,
      audit as never,
      { now: () => now },
      {} as never,
    );
    return { service, tx, audit };
  }

  it('marks a case Awaiting Customer in a permissible non-clarification workflow', async () => {
    const { service, tx, audit } = harness(RenewalCaseStatus.REMINDER_CYCLE);
    await service.markAwaitingCustomer('case-id', { actorId: 'actor-id' });
    expect(tx.renewalCase.updateMany).toHaveBeenCalledWith({
      where: { id: 'case-id', status: RenewalCaseStatus.REMINDER_CYCLE },
      data: { status: RenewalCaseStatus.AWAITING_CUSTOMER },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        eventKey: 'renewal.case.marked_awaiting_customer',
        oldState: expect.objectContaining({ id: 'case-id', status: RenewalCaseStatus.REMINDER_CYCLE }),
      }),
      tx,
    );
  });

  it('marks Accepted and stores the proposed period without changing the subscription', async () => {
    const { service, tx } = harness(RenewalCaseStatus.AWAITING_CUSTOMER);
    await service.markAccepted('case-id', { actorId: 'actor-id' });
    expect(tx.renewalCase.updateMany).toHaveBeenCalledWith({
      where: { id: 'case-id', status: RenewalCaseStatus.AWAITING_CUSTOMER },
      data: expect.objectContaining({
        status: RenewalCaseStatus.ACCEPTED,
        customerDecision: CustomerDecision.ACCEPTED,
        acceptedAt: now,
        clarificationPending: false,
        communicationRevision: { increment: 1 },
        proposedPeriodStart: due,
        proposedPeriodEnd: end,
        proposedNextRenewalDate: next,
      }),
    });
    expect(tx.subscription.updateMany).not.toHaveBeenCalled();
  });

  it('marks Do Not Renew, cancels pending clarification and fences late message acceptance', async () => {
    const { service, tx } = harness(RenewalCaseStatus.HUMAN_REVIEW);
    await service.markDoNotRenew('case-id', { actorId: 'actor-id' });
    expect(tx.renewalCase.updateMany).toHaveBeenCalledWith({
      where: { id: 'case-id', status: RenewalCaseStatus.HUMAN_REVIEW },
      data: {
        status: RenewalCaseStatus.DO_NOT_RENEW,
        customerDecision: CustomerDecision.REJECTED,
        doNotRenewAt: now,
        clarificationPending: false,
        communicationRevision: { increment: 1 },
      },
    });
  });

  it('fulfills an accepted renewal with a linked official invoice, without payment evidence', async () => {
    const { service, tx, audit } = harness(RenewalCaseStatus.ACCEPTED, { withOfficialInvoice: true });
    await service.markFulfilled('case-id', { actorId: 'actor-id' });
    expect(tx.subscription.updateMany).toHaveBeenCalledWith({
      where: { id: 'subscription-id', renewalDate: due },
      data: { renewalDate: next, currentTermEndDate: end },
    });
    expect(tx.renewalCase.updateMany).toHaveBeenCalledWith({
      where: { id: 'case-id', status: RenewalCaseStatus.ACCEPTED },
      data: {
        status: RenewalCaseStatus.FULFILLED,
        fulfilledAt: now,
        clarificationPending: false,
        communicationRevision: { increment: 1 },
      },
    });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      eventKey: 'renewal.case.marked_fulfilled',
      metadata: expect.objectContaining({ invoiceId: 'official-invoice-id', trackingOnly: true }),
    }), tx);
  });

  it('rejects an accepted renewal without a verified same-cycle official invoice', async () => {
    const { service, tx } = harness(RenewalCaseStatus.ACCEPTED);
    await expect(service.markFulfilled('case-id', { actorId: 'actor-id' }))
      .rejects.toBeInstanceOf(ConflictException);
    expect(tx.subscription.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a PAYMENT_CONFIRMED legacy case without accepted invoice evidence', async () => {
    const { service, tx } = harness(RenewalCaseStatus.PAYMENT_CONFIRMED);
    await expect(service.markFulfilled('case-id', { actorId: 'actor-id' }))
      .rejects.toBeInstanceOf(ConflictException);
    expect(tx.subscription.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    RenewalCaseStatus.CLOSED,
    RenewalCaseStatus.FULFILLED,
    RenewalCaseStatus.REJECTED,
    RenewalCaseStatus.DO_NOT_RENEW,
  ])('refuses to accept an already terminal case (%s)', async (terminalStatus) => {
    const { service } = harness(terminalStatus);
    await expect(service.markAccepted('case-id', { actorId: 'actor-id' }))
      .rejects.toThrow(/already .* cannot be moved/);
  });

  it('rejects ACCEPTED regressing to AWAITING_CUSTOMER', async () => {
    const { service, tx } = harness(RenewalCaseStatus.ACCEPTED);
    await expect(service.markAwaitingCustomer('case-id', { actorId: 'actor-id' }))
      .rejects.toBeInstanceOf(ConflictException);
    expect(tx.renewalCase.updateMany).not.toHaveBeenCalled();
  });

  it.each([RenewalCaseStatus.UPCOMING, RenewalCaseStatus.REMINDER_CYCLE])(
    'rejects premature fulfillment from %s', async (status) => {
      const { service, tx } = harness(status);
      await expect(service.markFulfilled('case-id', { actorId: 'actor-id' }))
        .rejects.toBeInstanceOf(ConflictException);
      expect(tx.subscription.updateMany).not.toHaveBeenCalled();
    },
  );

  it('reports a conflict when the status CAS loses to another operator', async () => {
    const { service, tx } = harness(RenewalCaseStatus.AWAITING_CUSTOMER, { updateManyCount: 0 });
    tx.renewalCase.findUnique = jest.fn(async () => ({
      id: 'case-id', status: RenewalCaseStatus.ACCEPTED,
    })) as never;
    await expect(service.markDoNotRenew('case-id', { actorId: 'actor-id' }))
      .rejects.toThrow(/changed concurrently/);
  });

  it('audits the previous status and newly accepted status without skipping the shared CAS', async () => {
    const { service, audit } = harness(RenewalCaseStatus.REMINDER_CYCLE);
    await service.markAccepted('case-id', { actorId: 'actor-id' });
    const call = audit.record.mock.calls[0]?.[0];
    if (!call) throw new Error('Expected the audit call');
    expect(call.oldState).toEqual(expect.objectContaining({
      id: 'case-id', status: RenewalCaseStatus.REMINDER_CYCLE,
    }));
    expect(call.newState.status).toBe(RenewalCaseStatus.ACCEPTED);
  });
});
