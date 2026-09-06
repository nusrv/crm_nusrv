import { jest } from '@jest/globals';
import { CustomerStatus } from '../../generated/prisma/enums';
import { CustomersService } from './customers.service';

describe('CustomersService', () => {
  it('creates a customer with one active Billing Entity and audits inside the transaction', async () => {
    const customer = {
      id: 'customer-id',
      customerCode: 'CUS-001',
      companyName: 'Customer',
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
    const service = new CustomersService(prisma as never, audit as never);

    const result = await service.create(
      {
        customerCode: 'CUS-001',
        companyName: 'Customer',
        primaryEmail: 'billing@example.test',
        billingEntityId: 'entity-id',
        preferredLanguage: 'en',
        status: CustomerStatus.ACTIVE,
      },
      { actorId: 'actor-id' },
    );

    expect(result).toBe(customer);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]?.[0].data).toMatchObject({ sourceSequence: 5 });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventKey: 'customer.created', subjectId: 'customer-id' }),
      tx,
    );
  });

  it('lists customers in source-appearance order by default, not alphabetically', async () => {
    const findMany = jest.fn(() => Promise.resolve([]));
    const prisma = {
      customer: { findMany, count: jest.fn(() => Promise.resolve(0)) },
    };
    const service = new CustomersService(prisma as never, {} as never);

    await service.list({ page: 1, pageSize: 20 });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ sourceSequence: 'asc' }, { createdAt: 'asc' }, { customerCode: 'asc' }],
      }),
    );
  });
});
