import { jest } from '@jest/globals';
import { BillingFrequency, SubscriptionStatus } from '../../generated/prisma/enums';
import { cycleStartDate } from '../renewal-cases/renewal-policy';
import { SubscriptionsService } from './subscriptions.service';

describe('SubscriptionsService.list filters', () => {
  it('filters by Service Type, package, Billing Entity, currency, and renewal date range', async () => {
    const findMany = jest.fn<(input: { where: Record<string, unknown> }) => Promise<never[]>>(() =>
      Promise.resolve([]),
    );
    const prisma = {
      subscription: { findMany, count: jest.fn(() => Promise.resolve(0)) },
    };
    const service = new SubscriptionsService(prisma as never, {} as never, {} as never);

    await service.list({
      page: 1,
      pageSize: 20,
      serviceTypeId: 'type-id',
      servicePackageId: 'package-id',
      billingEntityId: 'entity-id',
      currency: 'JOD',
      renewalFrom: '2026-01-01',
      renewalTo: '2026-12-31',
    });

    const where = findMany.mock.calls[0]?.[0].where;
    expect(where?.serviceTypeId).toBe('type-id');
    expect(where?.servicePackageId).toBe('package-id');
    expect(where?.currency).toBe('JOD');
    expect(where?.customer).toEqual({ billingEntityId: 'entity-id' });
    expect(where?.renewalDate).toEqual({
      gte: new Date('2026-01-01'),
      lte: new Date('2026-12-31'),
    });
  });

  it('omits the Billing Entity relation filter entirely when unset, rather than filtering by undefined', async () => {
    const findMany = jest.fn<(input: { where: Record<string, unknown> }) => Promise<never[]>>(() =>
      Promise.resolve([]),
    );
    const prisma = {
      subscription: { findMany, count: jest.fn(() => Promise.resolve(0)) },
    };
    const service = new SubscriptionsService(prisma as never, {} as never, {} as never);

    await service.list({ page: 1, pageSize: 20 });

    expect(findMany.mock.calls[0]?.[0].where).not.toHaveProperty('customer');
  });
});

describe('SubscriptionsService.create Subscription Code generation', () => {
  function harness() {
    const rateToJod = { mul: jest.fn(() => ({ toDecimalPlaces: () => '100.000' })) };
    const created = {
      id: 'subscription-id',
      sellingPrice: { toString: () => '100.000' },
      currencyDefinition: { rateToJod, effectiveDate: new Date('2026-01-01') },
    };
    const create = jest.fn<(input: { data: Record<string, unknown> }) => Promise<typeof created>>(
      () => Promise.resolve(created),
    );
    const tx = { subscription: { create } };
    const prisma = {
      customer: { findUnique: jest.fn(() => Promise.resolve({ status: 'ACTIVE' })) },
      serviceType: { findUnique: jest.fn(() => Promise.resolve({ active: true })) },
      currency: {
        findUnique: jest.fn(() =>
          Promise.resolve({
            code: 'JOD',
            active: true,
            rateToJod,
            effectiveDate: new Date('2026-01-01'),
          }),
        ),
      },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const audit = { record: jest.fn(() => Promise.resolve(undefined)) };
    const subscriptionCode = { next: jest.fn(() => Promise.resolve('FF0001-S03')) };
    const service = new SubscriptionsService(
      prisma as never,
      audit as never,
      subscriptionCode,
    );
    return { service, tx, create, subscriptionCode };
  }

  it('asks the central SubscriptionCodeService for the code, inside the creating transaction, instead of accepting one from the caller', async () => {
    const { service, tx, create, subscriptionCode } = harness();

    await service.create(
      {
        customerId: 'customer-id',
        serviceTypeId: 'type-id',
        name: 'Hosting',
        startDate: '2026-01-01',
        renewalIntervalMonths: 12,
        billingFrequency: BillingFrequency.ANNUAL,
        sellingPrice: '100.000',
        currency: 'JOD',
        providerAutoRenews: true,
        graceHours: 24,
        status: SubscriptionStatus.ACTIVE,
      },
      { actorId: 'actor-id' },
    );

    expect(subscriptionCode.next).toHaveBeenCalledWith(tx, 'customer-id');
    expect(create.mock.calls[0]?.[0].data.subscriptionCode).toBe('FF0001-S03');
  });
});

describe('SubscriptionsService.create Renewal Date derivation', () => {
  function harness() {
    const rateToJod = { mul: jest.fn(() => ({ toDecimalPlaces: () => '100.000' })) };
    const created = {
      id: 'subscription-id',
      sellingPrice: { toString: () => '100.000' },
      currencyDefinition: { rateToJod, effectiveDate: new Date('2026-01-01') },
    };
    const create = jest.fn<(input: { data: Record<string, unknown> }) => Promise<typeof created>>(
      () => Promise.resolve(created),
    );
    const tx = { subscription: { create } };
    const prisma = {
      customer: { findUnique: jest.fn(() => Promise.resolve({ status: 'ACTIVE' })) },
      serviceType: { findUnique: jest.fn(() => Promise.resolve({ active: true })) },
      currency: {
        findUnique: jest.fn(() =>
          Promise.resolve({
            code: 'JOD',
            active: true,
            rateToJod,
            effectiveDate: new Date('2026-01-01'),
          }),
        ),
      },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const audit = { record: jest.fn(() => Promise.resolve(undefined)) };
    const subscriptionCode = { next: jest.fn(() => Promise.resolve('FF0001-S01')) };
    const service = new SubscriptionsService(
      prisma as never,
      audit as never,
      subscriptionCode,
    );
    return { service, create };
  }

  async function createWith(startDate: string, renewalIntervalMonths: number) {
    const { service, create } = harness();
    await service.create(
      {
        customerId: 'customer-id',
        serviceTypeId: 'type-id',
        name: 'Hosting',
        startDate,
        renewalIntervalMonths,
        billingFrequency: BillingFrequency.ANNUAL,
        sellingPrice: '100.000',
        currency: 'JOD',
        providerAutoRenews: true,
        graceHours: 24,
        status: SubscriptionStatus.ACTIVE,
      },
      { actorId: 'actor-id' },
    );
    return create.mock.calls[0]?.[0].data as { renewalDate: Date; currentTermEndDate: Date };
  }

  it('Start 2026-09-09 + 12 months -> 2027-09-09', async () => {
    const data = await createWith('2026-09-09', 12);
    expect(data.renewalDate).toEqual(new Date('2027-09-09T00:00:00.000Z'));
    expect(data.currentTermEndDate).toEqual(data.renewalDate);
  });

  it('Start 2026-09-09 + 60 months -> 2031-09-09', async () => {
    const data = await createWith('2026-09-09', 60);
    expect(data.renewalDate).toEqual(new Date('2031-09-09T00:00:00.000Z'));
  });

  it('Custom 18 months from 2026-09-09 -> 2028-03-09', async () => {
    const data = await createWith('2026-09-09', 18);
    expect(data.renewalDate).toEqual(new Date('2028-03-09T00:00:00.000Z'));
  });

  it('end-of-month: 2027-01-31 + 1 month -> last valid day of February (28, non-leap 2027), never overflowing into March', async () => {
    const data = await createWith('2027-01-31', 1);
    expect(data.renewalDate).toEqual(new Date('2027-02-28T00:00:00.000Z'));
  });

  it('leap year: 2028-01-31 + 1 month -> 2028-02-29', async () => {
    const data = await createWith('2028-01-31', 1);
    expect(data.renewalDate).toEqual(new Date('2028-02-29T00:00:00.000Z'));
  });

  it.each([
    BillingFrequency.MONTHLY,
    BillingFrequency.QUARTERLY,
    BillingFrequency.SEMI_ANNUAL,
    BillingFrequency.ANNUAL,
    BillingFrequency.BIENNIAL,
    BillingFrequency.CUSTOM,
  ])(
    'Billing Frequency %s never changes the derived Renewal Date — only Renewal Interval does',
    async (billingFrequency) => {
      const { service, create } = harness();
      await service.create(
        {
          customerId: 'customer-id',
          serviceTypeId: 'type-id',
          name: 'Hosting',
          startDate: '2026-09-09',
          renewalIntervalMonths: 12,
          billingFrequency,
          sellingPrice: '100.000',
          currency: 'JOD',
          providerAutoRenews: true,
          graceHours: 24,
          status: SubscriptionStatus.ACTIVE,
        },
        { actorId: 'actor-id' },
      );
      const data = create.mock.calls[0]?.[0].data as { renewalDate: Date };
      expect(data.renewalDate).toEqual(new Date('2027-09-09T00:00:00.000Z'));
    },
  );

  it('Renewal Engine compatibility: the engine\'s own cycleStartDate() helper (unmodified) consumes the derived Renewal Date correctly, with no engine changes required', async () => {
    const data = await createWith('2026-09-09', 12);
    // Mirrors exactly how RenewalEngineService.ensureCase() calls this today — the derived
    // renewalDate plugs straight in, no different from any other renewalDate value it already
    // handled before this task.
    const cycleStart = cycleStartDate(
      new Date('2026-09-09T00:00:00.000Z'),
      data.renewalDate,
      BillingFrequency.ANNUAL,
      12,
    );
    expect(cycleStart).toEqual(new Date('2026-09-09T00:00:00.000Z'));
  });
});

describe('SubscriptionsService.update Customer immutability', () => {
  it('never reads input.customerId when resolving the parent Customer for a service/package change, even if a caller-supplied object happens to carry one', async () => {
    const oldState = {
      customerId: 'original-customer-id',
      serviceTypeId: 'old-type-id',
      servicePackageId: null,
      startDate: new Date('2026-01-01'),
      renewalDate: new Date('2027-01-01'),
      sellingPrice: { toString: () => '100.000' },
      currency: 'JOD',
      servicePackage: null,
      currencyDefinition: { rateToJod: null, effectiveDate: null },
    };
    const updated = { ...oldState };
    const customerFindUnique = jest.fn(() => Promise.resolve({ status: 'ACTIVE' }));
    const tx = { subscription: { update: jest.fn(() => Promise.resolve(updated)) } };
    const prisma = {
      subscription: { findUnique: jest.fn(() => Promise.resolve(oldState)) },
      customer: { findUnique: customerFindUnique },
      serviceType: { findUnique: jest.fn(() => Promise.resolve({ active: true })) },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const audit = { record: jest.fn(() => Promise.resolve(undefined)) };
    const service = new SubscriptionsService(prisma as never, audit as never, {} as never);

    // UpdateSubscriptionDto no longer declares customerId, but this proves the service itself
    // cannot be tricked into reassigning the Customer even if a raw object with an extra
    // `customerId` field reached it (e.g. a future caller bypassing the DTO type).
    await service.update(
      'subscription-id',
      { serviceTypeId: 'new-type-id', customerId: 'attacker-customer-id' } as never,
      { actorId: 'actor-id' },
    );

    expect(customerFindUnique).toHaveBeenCalledWith({
      where: { id: 'original-customer-id' },
      select: { status: true },
    });
  });
});

describe('SubscriptionsService.update Renewal Date handling', () => {
  function harness(overrides: {
    startDate: Date;
    renewalDate: Date;
    renewalIntervalMonths: number | null;
  }) {
    const oldState = {
      customerId: 'customer-id',
      serviceTypeId: 'type-id',
      servicePackageId: null,
      sellingPrice: { toString: () => '100.000' },
      currency: 'JOD',
      servicePackage: null,
      currencyDefinition: { rateToJod: null, effectiveDate: null },
      ...overrides,
    };
    const update = jest.fn<(input: { data: Record<string, unknown> }) => Promise<typeof oldState>>(
      () => Promise.resolve(oldState),
    );
    const tx = { subscription: { update } };
    const prisma = {
      subscription: { findUnique: jest.fn(() => Promise.resolve(oldState)) },
      customer: { findUnique: jest.fn(() => Promise.resolve({ status: 'ACTIVE' })) },
      serviceType: { findUnique: jest.fn(() => Promise.resolve({ active: true })) },
      currency: {
        findUnique: jest.fn(() =>
          Promise.resolve({
            code: 'JOD',
            active: true,
            rateToJod: { mul: jest.fn(() => ({ toDecimalPlaces: () => '150.000' })) },
            effectiveDate: new Date('2026-01-01'),
          }),
        ),
      },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const audit = { record: jest.fn(() => Promise.resolve(undefined)) };
    const service = new SubscriptionsService(prisma as never, audit as never, {} as never);
    return { service, update };
  }

  it('editing only Selling Price does not touch a historical Renewal Date', async () => {
    const { service, update } = harness({
      startDate: new Date('2019-01-23T00:00:00.000Z'),
      renewalDate: new Date('2020-01-22T00:00:00.000Z'),
      renewalIntervalMonths: 12,
    });

    await service.update('subscription-id', { sellingPrice: '150.000' }, { actorId: 'actor-id' });

    const data = update.mock.calls[0]?.[0].data;
    expect(data?.startDate).toBeUndefined();
    expect(data?.renewalDate).toBeUndefined();
  });

  it('echoing back the same existing Start Date does not recalculate a preserved non-canonical historical Renewal Date', async () => {
    // The stored renewalDate here (2020-01-22) is deliberately ONE DAY OFF from what
    // addCalendarMonths(2019-01-23, 12) would compute (2020-01-23) — exactly the shape of a
    // preserved historical correction. Presence-based "changed" detection would recalculate and
    // silently overwrite it just because the form re-submitted the same startDate value.
    const { service, update } = harness({
      startDate: new Date('2019-01-23T00:00:00.000Z'),
      renewalDate: new Date('2020-01-22T00:00:00.000Z'),
      renewalIntervalMonths: 12,
    });

    await service.update(
      'subscription-id',
      { startDate: '2019-01-23', sellingPrice: '150.000' },
      { actorId: 'actor-id' },
    );

    const data = update.mock.calls[0]?.[0].data;
    expect(data?.renewalDate).toBeUndefined();
  });

  it('echoing back the same existing Renewal Interval does not recalculate a preserved non-canonical historical Renewal Date', async () => {
    const { service, update } = harness({
      startDate: new Date('2019-01-23T00:00:00.000Z'),
      renewalDate: new Date('2020-01-22T00:00:00.000Z'),
      renewalIntervalMonths: 12,
    });

    await service.update(
      'subscription-id',
      { renewalIntervalMonths: 12, sellingPrice: '150.000' },
      { actorId: 'actor-id' },
    );

    const data = update.mock.calls[0]?.[0].data;
    expect(data?.renewalDate).toBeUndefined();
  });

  it('editing Start Date intentionally recalculates the Renewal Date from the (unchanged) Renewal Interval', async () => {
    const { service, update } = harness({
      startDate: new Date('2026-01-01T00:00:00.000Z'),
      renewalDate: new Date('2027-01-01T00:00:00.000Z'),
      renewalIntervalMonths: 12,
    });

    await service.update('subscription-id', { startDate: '2026-02-01' }, { actorId: 'actor-id' });

    const data = update.mock.calls[0]?.[0].data;
    expect(data?.renewalDate).toEqual(new Date('2027-02-01T00:00:00.000Z'));
  });

  it('editing Renewal Interval intentionally recalculates the Renewal Date from the (unchanged) Start Date', async () => {
    const { service, update } = harness({
      startDate: new Date('2026-01-01T00:00:00.000Z'),
      renewalDate: new Date('2027-01-01T00:00:00.000Z'),
      renewalIntervalMonths: 12,
    });

    await service.update(
      'subscription-id',
      { renewalIntervalMonths: 24 },
      { actorId: 'actor-id' },
    );

    const data = update.mock.calls[0]?.[0].data;
    expect(data?.renewalDate).toEqual(new Date('2028-01-01T00:00:00.000Z'));
  });

  it('rejects an explicit Renewal Date on a modern subscription even when Start Date and Renewal Interval also change in the same request — the derived value must win by rejection, not by silent override', async () => {
    const { service } = harness({
      startDate: new Date('2026-01-01T00:00:00.000Z'),
      renewalDate: new Date('2027-01-01T00:00:00.000Z'),
      renewalIntervalMonths: 12,
    });

    await expect(
      service.update(
        'subscription-id',
        // Deliberately contradictory: this renewalDate does not match startDate + interval.
        { startDate: '2026-02-01', renewalIntervalMonths: 12, renewalDate: '2026-02-02' },
        { actorId: 'actor-id' },
      ),
    ).rejects.toThrow(
      'Renewal Date cannot be set directly for a subscription with a Renewal Interval',
    );
  });

  it('rejects an explicit Renewal Date on a modern subscription when Start Date and Renewal Interval are BOTH absent from the request', async () => {
    const { service, update } = harness({
      startDate: new Date('2026-01-01T00:00:00.000Z'),
      renewalDate: new Date('2027-01-01T00:00:00.000Z'),
      renewalIntervalMonths: 12,
    });

    // No startDate, no renewalIntervalMonths — only a directly supplied, unrelated renewalDate.
    // A caller must not be able to set an arbitrary Renewal Date on a subscription that already
    // has a Renewal Interval on record, regardless of what else the request does or doesn't touch
    // — and the API must say so explicitly (reject) rather than silently discard the value.
    await expect(
      service.update('subscription-id', { renewalDate: '2099-01-01' }, { actorId: 'actor-id' }),
    ).rejects.toThrow(
      'Renewal Date cannot be set directly for a subscription with a Renewal Interval',
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects an explicit Renewal Date when a stored/effective interval of 0 makes the subscription "modern" — 0 is not the same as null and must not enter legacy free-date mode', async () => {
    const { service, update } = harness({
      startDate: new Date('2026-01-01T00:00:00.000Z'),
      renewalDate: new Date('2027-01-01T00:00:00.000Z'),
      // Not a value normal DTO validation can ever produce (Create requires >= 1, and Update now
      // rejects clearing to null but this predates that: a 0 already sitting in the database from
      // before these rules existed). The gate must be a nullish check, not a falsy check, or this
      // would be mistaken for "no interval" and incorrectly allowed into legacy free-date mode.
      renewalIntervalMonths: 0,
    });

    await expect(
      service.update('subscription-id', { renewalDate: '2099-01-01' }, { actorId: 'actor-id' }),
    ).rejects.toThrow(
      'Renewal Date cannot be set directly for a subscription with a Renewal Interval',
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('accepts an explicit Renewal Date as a direct historical correction when neither Start Date nor Renewal Interval changes', async () => {
    const { service, update } = harness({
      startDate: new Date('2019-01-23T00:00:00.000Z'),
      renewalDate: new Date('2020-01-22T00:00:00.000Z'),
      renewalIntervalMonths: null,
    });

    await service.update(
      'subscription-id',
      { renewalDate: '2020-06-01' },
      { actorId: 'actor-id' },
    );

    const data = update.mock.calls[0]?.[0].data;
    expect(data?.renewalDate).toEqual(new Date('2020-06-01T00:00:00.000Z'));
  });

  it('rejects moving Start Date on/after the untouched Renewal Date when there is no interval to recompute from and no explicit override', async () => {
    const { service } = harness({
      startDate: new Date('2019-01-23T00:00:00.000Z'),
      renewalDate: new Date('2020-01-22T00:00:00.000Z'),
      renewalIntervalMonths: null,
    });

    await expect(
      service.update('subscription-id', { startDate: '2021-01-01' }, { actorId: 'actor-id' }),
    ).rejects.toThrow('Renewal date must be after start date.');
  });
});

describe('SubscriptionsService.remove', () => {
  function harness(renewalCaseCount: number) {
    const subscription = {
      id: 'subscription-id',
      subscriptionCode: 'FF0001-S01',
      name: 'Hosting',
      customerId: 'customer-id',
    };
    const tx = {
      subscription: {
        findUnique: jest.fn(() => Promise.resolve(subscription)),
        delete: jest.fn(() => Promise.resolve(subscription)),
      },
      renewalCase: {
        count: jest.fn(() => Promise.resolve(renewalCaseCount)),
        findMany: jest.fn(() => Promise.resolve([{ id: 'case-1' }, { id: 'case-2' }])),
        deleteMany: jest.fn(() => Promise.resolve({ count: 2 })),
      },
      communicationOutbox: { deleteMany: jest.fn(() => Promise.resolve({ count: 0 })) },
      renewalEvaluationDecision: { deleteMany: jest.fn(() => Promise.resolve({ count: 0 })) },
      renewalHold: { deleteMany: jest.fn(() => Promise.resolve({ count: 0 })) },
      legacyImportSubscriptionLink: { deleteMany: jest.fn(() => Promise.resolve({ count: 0 })) },
      subscriptionIdentifier: { deleteMany: jest.fn(() => Promise.resolve({ count: 0 })) },
      subscriptionConnection: { deleteMany: jest.fn(() => Promise.resolve({ count: 0 })) },
    };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const audit = { record: jest.fn(() => Promise.resolve(undefined)) };
    const service = new SubscriptionsService(prisma as never, audit as never, {} as never);
    return { service, tx, audit };
  }

  it('cascades every dependent row in order, deletes the subscription, and audits it', async () => {
    const { service, tx, audit } = harness(0);

    const result = await service.remove('subscription-id', { actorId: 'actor-id' });

    expect(result).toEqual({ id: 'subscription-id', deleted: true });
    expect(tx.renewalCase.findMany).toHaveBeenCalledWith({
      where: { subscriptionId: 'subscription-id' },
      select: { id: true },
    });
    expect(tx.communicationOutbox.deleteMany).toHaveBeenCalledWith({
      where: { renewalCaseId: { in: ['case-1', 'case-2'] } },
    });
    expect(tx.renewalEvaluationDecision.deleteMany).toHaveBeenCalledWith({
      where: { renewalCaseId: { in: ['case-1', 'case-2'] } },
    });
    expect(tx.renewalHold.deleteMany).toHaveBeenCalledWith({
      where: { renewalCaseId: { in: ['case-1', 'case-2'] } },
    });
    expect(tx.renewalCase.deleteMany).toHaveBeenCalledWith({
      where: { subscriptionId: 'subscription-id' },
    });
    expect(tx.legacyImportSubscriptionLink.deleteMany).toHaveBeenCalledWith({
      where: { subscriptionId: 'subscription-id' },
    });
    expect(tx.subscriptionIdentifier.deleteMany).toHaveBeenCalledWith({
      where: { subscriptionId: 'subscription-id' },
    });
    expect(tx.subscriptionConnection.deleteMany).toHaveBeenCalledWith({
      where: { subscriptionId: 'subscription-id' },
    });
    expect(tx.communicationOutbox.deleteMany).toHaveBeenCalledWith({
      where: { subscriptionId: 'subscription-id' },
    });
    expect(tx.subscription.delete).toHaveBeenCalledWith({ where: { id: 'subscription-id' } });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventKey: 'subscription.deleted', subjectId: 'subscription-id' }),
      tx,
    );
  });

  it('refuses to delete a subscription with an active (non-terminal) Renewal Case', async () => {
    const { service, tx } = harness(1);

    await expect(service.remove('subscription-id', { actorId: 'actor-id' })).rejects.toThrow(
      'Cannot delete a subscription with active renewal cases. Close or cancel them first.',
    );
    expect(tx.subscription.delete).not.toHaveBeenCalled();
  });

  it('throws NotFoundException for a subscription that does not exist', async () => {
    const tx = { subscription: { findUnique: jest.fn(() => Promise.resolve(null)) } };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = new SubscriptionsService(prisma as never, {} as never, {} as never);

    await expect(service.remove('missing-id', { actorId: 'actor-id' })).rejects.toThrow(
      'Subscription not found.',
    );
  });
});
