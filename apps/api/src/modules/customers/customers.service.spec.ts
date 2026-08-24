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
    const tx = { customer: { create: jest.fn(() => Promise.resolve(customer)) } };
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
    expect(tx.customer.create).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventKey: 'customer.created', subjectId: 'customer-id' }),
      tx,
    );
  });
});
