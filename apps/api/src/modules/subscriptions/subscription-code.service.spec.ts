import { jest } from '@jest/globals';
import { SubscriptionCodeService } from './subscription-code.service';

describe('SubscriptionCodeService', () => {
  it('formats the Customer Code with the incremented sequence value, zero-padded to 2 digits', async () => {
    const tx = {
      customer: {
        findUnique: jest.fn(() => Promise.resolve({ customerCode: 'FF0001' })),
      },
      subscriptionCodeSequence: {
        upsert: jest.fn(() => Promise.resolve({ customerId: 'customer-id', lastValue: 1 })),
      },
    };
    const service = new SubscriptionCodeService();

    const code = await service.next(tx as never, 'customer-id');

    expect(code).toBe('FF0001-S01');
    expect(tx.subscriptionCodeSequence.upsert).toHaveBeenCalledWith({
      where: { customerId: 'customer-id' },
      create: { customerId: 'customer-id', lastValue: 1 },
      update: { lastValue: { increment: 1 } },
    });
  });

  it('assigns S02 for a second subscription under the same customer', async () => {
    const tx = {
      customer: { findUnique: jest.fn(() => Promise.resolve({ customerCode: 'NS0001' })) },
      subscriptionCodeSequence: {
        upsert: jest.fn(() => Promise.resolve({ customerId: 'customer-id', lastValue: 2 })),
      },
    };
    const service = new SubscriptionCodeService();

    expect(await service.next(tx as never, 'customer-id')).toBe('NS0001-S02');
  });

  it('does not artificially cap the sequence at 2 digits — it just grows', async () => {
    const tx = {
      customer: { findUnique: jest.fn(() => Promise.resolve({ customerCode: 'FF0042' })) },
      subscriptionCodeSequence: {
        upsert: jest.fn(() => Promise.resolve({ customerId: 'customer-id', lastValue: 100 })),
      },
    };
    const service = new SubscriptionCodeService();

    expect(await service.next(tx as never, 'customer-id')).toBe('FF0042-S100');
  });

  it('rejects a Customer that does not exist', async () => {
    const tx = {
      customer: { findUnique: jest.fn(() => Promise.resolve(null)) },
      subscriptionCodeSequence: { upsert: jest.fn() },
    };
    const service = new SubscriptionCodeService();

    await expect(service.next(tx as never, 'missing-customer')).rejects.toThrow(
      'Customer not found.',
    );
    expect(tx.subscriptionCodeSequence.upsert).not.toHaveBeenCalled();
  });
});
