import { jest } from '@jest/globals';
import { CustomerCodeService } from './customer-code.service';

describe('CustomerCodeService', () => {
  it('formats the prefix with the incremented sequence value, zero-padded to 4 digits', async () => {
    const tx = {
      billingEntity: {
        findUnique: jest.fn(() => Promise.resolve({ customerCodePrefix: 'FF' })),
      },
      customerCodeSequence: {
        upsert: jest.fn(() => Promise.resolve({ billingEntityId: 'entity-id', lastValue: 1 })),
      },
    };
    const service = new CustomerCodeService();

    const code = await service.next(tx as never, 'entity-id');

    expect(code).toBe('FF0001');
    expect(tx.customerCodeSequence.upsert).toHaveBeenCalledWith({
      where: { billingEntityId: 'entity-id' },
      create: { billingEntityId: 'entity-id', lastValue: 1 },
      update: { lastValue: { increment: 1 } },
    });
  });

  it('does not artificially cap the sequence at 4 digits — it just grows', async () => {
    const tx = {
      billingEntity: {
        findUnique: jest.fn(() => Promise.resolve({ customerCodePrefix: 'NS' })),
      },
      customerCodeSequence: {
        upsert: jest.fn(() => Promise.resolve({ billingEntityId: 'entity-id', lastValue: 10023 })),
      },
    };
    const service = new CustomerCodeService();

    expect(await service.next(tx as never, 'entity-id')).toBe('NS10023');
  });

  it('rejects a Billing Entity that does not exist', async () => {
    const tx = {
      billingEntity: { findUnique: jest.fn(() => Promise.resolve(null)) },
      customerCodeSequence: { upsert: jest.fn() },
    };
    const service = new CustomerCodeService();

    await expect(service.next(tx as never, 'missing-entity')).rejects.toThrow(
      'Billing Entity not found.',
    );
    expect(tx.customerCodeSequence.upsert).not.toHaveBeenCalled();
  });
});
