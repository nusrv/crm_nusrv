import { jest } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';
import { CustomersService } from '../customers/customers.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';

describe('invoice financial-record retention', () => {
  it('blocks Customer deletion before any dependent row is removed when invoice history exists', async () => {
    const tx = {
      customer: {
        findUnique: jest.fn(() =>
          Promise.resolve({
            id: 'customer-1',
            customerCode: 'NS0001',
            nameEn: 'Customer',
            nameAr: null,
          }),
        ),
      },
      invoice: { count: jest.fn(() => Promise.resolve(1)) },
      subscription: { deleteMany: jest.fn() },
    };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = new CustomersService(prisma as never, {} as never, {} as never, {} as never);

    await expect(
      service.deleteCustomer('customer-1', { actorId: 'user-1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.subscription.deleteMany).not.toHaveBeenCalled();
  });

  it('blocks Subscription deletion before any dependent row is removed when invoice history exists', async () => {
    const tx = {
      subscription: {
        findUnique: jest.fn(() =>
          Promise.resolve({
            id: 'subscription-1',
            subscriptionCode: 'NS0001-S01',
            name: 'Hosting',
            customerId: 'customer-1',
          }),
        ),
        delete: jest.fn(),
      },
      invoice: { count: jest.fn(() => Promise.resolve(1)) },
    };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = new SubscriptionsService(prisma as never, {} as never, {} as never);

    await expect(service.remove('subscription-1', { actorId: 'user-1' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(tx.subscription.delete).not.toHaveBeenCalled();
  });
});
