import { jest } from '@jest/globals';
import { CustomerStatus, SubscriptionStatus } from '../../generated/prisma/enums';
import { CustomersService } from './customers.service';

describe('CustomersService', () => {
  it('creates a customer with a server-generated code and audits inside the transaction', async () => {
    const customer = {
      id: 'customer-id',
      customerCode: 'TL0005',
      nameEn: 'Customer',
      nameAr: null,
      billingEntityId: 'entity-id',
      status: CustomerStatus.ACTIVE,
    };
    const create = jest.fn<(input: { data: Record<string, unknown> }) => Promise<typeof customer>>(
      () => Promise.resolve(customer),
    );
    const tx = {
      customer: {
        create,
        aggregate: jest.fn(() => Promise.resolve({ _max: { sourceSequence: 4 } })),
      },
    };
    const prisma = {
      billingEntity: { findUnique: jest.fn(() => Promise.resolve({ active: true })) },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const audit = { record: jest.fn(() => Promise.resolve({ id: 'audit-id' })) };
    const customerCode = { next: jest.fn(() => Promise.resolve('TL0005')) };
    const service = new CustomersService(prisma as never, audit as never, customerCode);

    const result = await service.create(
      {
        nameEn: 'Customer',
        primaryEmail: 'billing@example.test',
        billingEntityId: 'entity-id',
        preferredLanguage: 'en',
        status: CustomerStatus.ACTIVE,
      },
      { actorId: 'actor-id' },
    );

    expect(result).toBe(customer);
    expect(customerCode.next).toHaveBeenCalledWith(tx, 'entity-id');
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]?.[0].data).toMatchObject({
      sourceSequence: 5,
      customerCode: 'TL0005',
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventKey: 'customer.created', subjectId: 'customer-id' }),
      tx,
    );
  });

  it('rejects creation when both English and Arabic names are empty', async () => {
    const prisma = {
      billingEntity: { findUnique: jest.fn(() => Promise.resolve({ active: true })) },
      $transaction: jest.fn(),
    };
    const service = new CustomersService(
      prisma as never,
      {} as never,
      { next: jest.fn() } as never,
    );

    await expect(
      service.create(
        {
          primaryEmail: 'billing@example.test',
          billingEntityId: 'entity-id',
          preferredLanguage: 'en',
          status: CustomerStatus.ACTIVE,
        },
        { actorId: 'actor-id' },
      ),
    ).rejects.toThrow('Provide a Customer Name in English, Arabic, or both');
  });

  it('accepts creation with only an Arabic name', async () => {
    const customer = { id: 'customer-id', nameEn: null, nameAr: 'Arabic Name' };
    const create = jest.fn(() => Promise.resolve(customer));
    const tx = {
      customer: { create, aggregate: jest.fn(() => Promise.resolve({ _max: { sourceSequence: null } })) },
    };
    const prisma = {
      billingEntity: { findUnique: jest.fn(() => Promise.resolve({ active: true })) },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const audit = { record: jest.fn(() => Promise.resolve({ id: 'audit-id' })) };
    const customerCode = { next: jest.fn(() => Promise.resolve('TL0001')) };
    const service = new CustomersService(prisma as never, audit as never, customerCode);

    await expect(
      service.create(
        {
          nameAr: 'Arabic Name',
          primaryEmail: 'billing@example.test',
          billingEntityId: 'entity-id',
          preferredLanguage: 'en',
          status: CustomerStatus.ACTIVE,
        },
        { actorId: 'actor-id' },
      ),
    ).resolves.toBe(customer);
  });

  it('lists customers in source-appearance order by default, not alphabetically', async () => {
    const findMany = jest.fn(() => Promise.resolve([]));
    const prisma = {
      customer: { findMany, count: jest.fn(() => Promise.resolve(0)) },
    };
    const service = new CustomersService(prisma as never, {} as never, {} as never);

    await service.list({ page: 1, pageSize: 20 });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ sourceSequence: 'asc' }, { createdAt: 'asc' }, { customerCode: 'asc' }],
      }),
    );
  });

  describe('update — deactivation cascade', () => {
    function buildDeactivationHarness(oldStatus: CustomerStatus) {
      const oldState = {
        id: 'customer-id',
        status: oldStatus,
        nameEn: 'Customer',
        nameAr: null,
        phone: null,
      };
      const updatedCustomer = { ...oldState, status: CustomerStatus.INACTIVE };
      const updateMany = jest.fn(() => Promise.resolve({ count: 2 }));
      const tx = {
        customer: { update: jest.fn(() => Promise.resolve(updatedCustomer)) },
        subscription: { updateMany },
      };
      const prisma = {
        customer: { findUnique: jest.fn(() => Promise.resolve(oldState)) },
        $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
      };
      const audit = { record: jest.fn(() => Promise.resolve({ id: 'audit-id' })) };
      const service = new CustomersService(prisma as never, audit as never, {} as never);
      return { service, updateMany, audit };
    }

    it('suspends every ACTIVE subscription when a customer transitions to INACTIVE', async () => {
      const { service, updateMany, audit } = buildDeactivationHarness(CustomerStatus.ACTIVE);

      await service.update(
        'customer-id',
        { status: CustomerStatus.INACTIVE },
        { actorId: 'actor-id' },
      );

      expect(updateMany).toHaveBeenCalledWith({
        where: { customerId: 'customer-id', status: SubscriptionStatus.ACTIVE },
        data: { status: SubscriptionStatus.SUSPENDED },
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: { subscriptionsSuspended: 2 } }),
        expect.anything(),
      );
    });

    it('does not touch subscriptions when a customer is reactivated', async () => {
      const { service, updateMany } = buildDeactivationHarness(CustomerStatus.INACTIVE);

      await service.update(
        'customer-id',
        { status: CustomerStatus.ACTIVE },
        { actorId: 'actor-id' },
      );

      expect(updateMany).not.toHaveBeenCalled();
    });

    it('does not re-suspend subscriptions when an already-inactive customer is otherwise edited', async () => {
      const { service, updateMany } = buildDeactivationHarness(CustomerStatus.INACTIVE);

      await service.update(
        'customer-id',
        { status: CustomerStatus.INACTIVE, nameEn: 'Renamed' },
        { actorId: 'actor-id' },
      );

      expect(updateMany).not.toHaveBeenCalled();
    });
  });
});
