import { jest } from '@jest/globals';
import { BillingFrequency, SubscriptionStatus } from '../../generated/prisma/enums';
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
        renewalDate: '2027-01-01',
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
