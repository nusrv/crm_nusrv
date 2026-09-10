import { jest } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';
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
    const service = new CustomersService(prisma as never, audit as never, customerCode, {} as never);

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
      {} as never,
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
      customer: {
        create,
        aggregate: jest.fn(() => Promise.resolve({ _max: { sourceSequence: null } })),
      },
    };
    const prisma = {
      billingEntity: { findUnique: jest.fn(() => Promise.resolve({ active: true })) },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const audit = { record: jest.fn(() => Promise.resolve({ id: 'audit-id' })) };
    const customerCode = { next: jest.fn(() => Promise.resolve('TL0001')) };
    const service = new CustomersService(prisma as never, audit as never, customerCode, {} as never);

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
    const service = new CustomersService(prisma as never, {} as never, {} as never, {} as never);

    await service.list({ page: 1, pageSize: 20 });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ sourceSequence: 'asc' }, { createdAt: 'asc' }, { customerCode: 'asc' }],
      }),
    );
  });

  it('filters by Billing Entity and created-date range', async () => {
    const findMany = jest.fn<(input: { where: Record<string, unknown> }) => Promise<never[]>>(() =>
      Promise.resolve([]),
    );
    const prisma = {
      customer: { findMany, count: jest.fn(() => Promise.resolve(0)) },
    };
    const service = new CustomersService(prisma as never, {} as never, {} as never, {} as never);

    await service.list({
      page: 1,
      pageSize: 20,
      billingEntityId: 'entity-id',
      createdFrom: '2026-01-01',
      createdTo: '2026-01-31',
    });

    const where = findMany.mock.calls[0]?.[0].where;
    expect(where?.billingEntityId).toBe('entity-id');
    expect(where?.createdAt).toEqual({
      gte: new Date('2026-01-01'),
      lte: new Date('2026-01-31'),
    });
  });

  describe('update — no lifecycle-status side effects', () => {
    it('never touches subscriptions, since UpdateCustomerDto carries no status field', async () => {
      const oldState = {
        id: 'customer-id',
        status: CustomerStatus.ACTIVE,
        nameEn: 'Customer',
        nameAr: null,
        phone: null,
      };
      const updatedCustomer = { ...oldState, nameEn: 'Renamed' };
      const updateMany = jest.fn();
      const tx = {
        customer: { update: jest.fn(() => Promise.resolve(updatedCustomer)) },
        subscription: { updateMany },
      };
      const prisma = {
        customer: { findUnique: jest.fn(() => Promise.resolve(oldState)) },
        $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
      };
      const audit = { record: jest.fn(() => Promise.resolve({ id: 'audit-id' })) };
      const service = new CustomersService(prisma as never, audit as never, {} as never, {} as never);

      await service.update('customer-id', { nameEn: 'Renamed' }, { actorId: 'actor-id' });

      expect(updateMany).not.toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ eventKey: 'customer.updated' }),
        expect.anything(),
      );
    });
  });

  describe('deactivate / reactivate', () => {
    function buildStatusHarness(oldStatus: CustomerStatus) {
      const oldState = {
        id: 'customer-id',
        status: oldStatus,
        nameEn: 'Customer',
        nameAr: null,
        phone: null,
      };
      const updateMany = jest.fn(() => Promise.resolve({ count: 2 }));
      const tx = {
        customer: {
          update: jest.fn(({ data }: { data: { status: CustomerStatus } }) =>
            Promise.resolve({ ...oldState, status: data.status }),
          ),
        },
        subscription: { updateMany },
      };
      const prisma = {
        customer: { findUnique: jest.fn(() => Promise.resolve(oldState)) },
        $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
      };
      const audit = { record: jest.fn(() => Promise.resolve({ id: 'audit-id' })) };
      const service = new CustomersService(prisma as never, audit as never, {} as never, {} as never);
      return { service, updateMany, audit };
    }

    it('deactivate() suspends every ACTIVE subscription and audits the count', async () => {
      const { service, updateMany, audit } = buildStatusHarness(CustomerStatus.ACTIVE);

      await service.deactivate('customer-id', { actorId: 'actor-id' });

      expect(updateMany).toHaveBeenCalledWith({
        where: { customerId: 'customer-id', status: SubscriptionStatus.ACTIVE },
        data: { status: SubscriptionStatus.SUSPENDED },
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          eventKey: 'customer.status_changed',
          metadata: { subscriptionsSuspended: 2 },
        }),
        expect.anything(),
      );
    });

    it('reactivate() does not touch subscriptions', async () => {
      const { service, updateMany } = buildStatusHarness(CustomerStatus.INACTIVE);

      await service.reactivate('customer-id', { actorId: 'actor-id' });

      expect(updateMany).not.toHaveBeenCalled();
    });

    it('deactivate() rejects an already-inactive customer as a no-op', async () => {
      const { service, updateMany } = buildStatusHarness(CustomerStatus.INACTIVE);

      await expect(
        service.deactivate('customer-id', { actorId: 'actor-id' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(updateMany).not.toHaveBeenCalled();
    });

    it('reactivate() rejects an already-active customer as a no-op', async () => {
      const { service, updateMany } = buildStatusHarness(CustomerStatus.ACTIVE);

      await expect(
        service.reactivate('customer-id', { actorId: 'actor-id' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(updateMany).not.toHaveBeenCalled();
    });
  });

  describe('findOne — effective primary email display correctness', () => {
    function harness(resolved: { email: string; source: string } | null) {
      const customer = { id: 'customer-id', primaryEmail: 'stale@example.test' };
      const prisma = { customer: { findUnique: jest.fn(() => Promise.resolve(customer)) } };
      const emailResolution = {
        resolvePrimaryRecipient: jest.fn<() => Promise<typeof resolved>>(() =>
          Promise.resolve(resolved),
        ),
      };
      const service = new CustomersService(
        prisma as never,
        {} as never,
        {} as never,
        emailResolution as never,
      );
      return { service, emailResolution };
    }

    it('includes the authoritative effectivePrimaryEmail alongside the legacy scalar when an active primary channel exists', async () => {
      const { service } = harness({ email: 'active@example.test', source: 'NORMALIZED_PRIMARY' });

      const result = await service.findOne('customer-id');

      expect(result.primaryEmail).toBe('stale@example.test');
      expect(result.effectivePrimaryEmail).toEqual({
        email: 'active@example.test',
        source: 'NORMALIZED_PRIMARY',
      });
    });

    it('never presents the stale scalar as the current usable primary recipient when no valid one exists', async () => {
      const { service } = harness(null);

      const result = await service.findOne('customer-id');

      // The scalar is still present for backward compatibility, but effectivePrimaryEmail — the
      // field callers/UI must use to know "is there a valid recipient right now" — is explicitly
      // null, not a fallback to the stale 'stale@example.test' value.
      expect(result.primaryEmail).toBe('stale@example.test');
      expect(result.effectivePrimaryEmail).toBeNull();
    });
  });
});
