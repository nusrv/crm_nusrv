import { jest } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';
import { CurrenciesService } from './currencies.service';

describe('CurrenciesService', () => {
  it('creates a currency and audits the stored 1-unit-to-JOD direction', async () => {
    const currency = {
      code: 'USD',
      name: 'US Dollar',
      rateToJod: '0.709000000',
      effectiveDate: new Date('2026-08-31'),
      active: true,
    };
    const create = jest.fn<(input: { data: Record<string, unknown> }) => Promise<typeof currency>>(
      () => Promise.resolve(currency),
    );
    const tx = { currency: { create } };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const audit = { record: jest.fn(() => Promise.resolve({ id: 'audit-id' })) };
    const service = new CurrenciesService(prisma as never, audit as never);

    const result = await service.create(
      {
        code: 'USD',
        name: 'US Dollar',
        rateToJod: '0.709000000',
        effectiveDate: '2026-08-31',
        active: true,
      },
      { actorId: 'actor-id' },
    );

    expect(result).toBe(currency);
    expect(create.mock.calls[0]?.[0].data).toMatchObject({
      code: 'USD',
      rateToJod: '0.709000000',
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        eventKey: 'currency.created',
        subjectId: 'USD',
        metadata: { direction: '1 USD = 0.709000000 JOD' },
      }),
      tx,
    );
  });

  it('rejects a currency without both a rate and an effective date', async () => {
    const prisma = { $transaction: jest.fn() };
    const audit = { record: jest.fn() };
    const service = new CurrenciesService(prisma as never, audit as never);

    await expect(
      service.create({ code: 'EUR', name: 'Euro', active: true } as never, { actorId: 'actor-id' }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses to leave JOD inactive or repriced away from a rate of 1', async () => {
    const prisma = { $transaction: jest.fn() };
    const audit = { record: jest.fn() };
    const service = new CurrenciesService(prisma as never, audit as never);

    await expect(
      service.create(
        {
          code: 'JOD',
          name: 'Jordanian Dinar',
          rateToJod: '1.5',
          effectiveDate: '2026-08-31',
          active: true,
        },
        { actorId: 'actor-id' },
      ),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.create(
        {
          code: 'JOD',
          name: 'Jordanian Dinar',
          rateToJod: '1',
          effectiveDate: '2026-08-31',
          active: false,
        },
        { actorId: 'actor-id' },
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('updates the exchange rate while preserving the currency code and auditing before/after state', async () => {
    const oldState = {
      code: 'USD',
      name: 'US Dollar',
      rateToJod: { toString: () => '0.709000000' },
      effectiveDate: { toISOString: () => '2026-08-01T00:00:00.000Z' },
      active: true,
    };
    const newState = {
      code: 'USD',
      name: 'US Dollar',
      rateToJod: '0.710000000',
      effectiveDate: new Date('2026-08-31'),
      active: true,
    };
    const update = jest.fn<
      (input: {
        where: { code: string };
        data: Record<string, unknown>;
      }) => Promise<typeof newState>
    >(() => Promise.resolve(newState));
    const tx = { currency: { update } };
    const prisma = {
      currency: { findUnique: jest.fn(() => Promise.resolve(oldState)) },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const audit = { record: jest.fn(() => Promise.resolve({ id: 'audit-id' })) };
    const service = new CurrenciesService(prisma as never, audit as never);

    const result = await service.update(
      'usd',
      {
        rateToJod: '0.710000000',
        effectiveDate: '2026-08-31',
        changeReason: 'Central bank update',
      },
      { actorId: 'actor-id' },
    );

    expect(result).toBe(newState);
    expect(update.mock.calls[0]?.[0]).toMatchObject({
      where: { code: 'USD' },
      data: { rateToJod: '0.710000000' },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        eventKey: 'currency.updated',
        subjectId: 'USD',
        oldState,
        newState,
        metadata: { direction: '1 USD = 0.710000000 JOD', changeReason: 'Central bank update' },
      }),
      tx,
    );
  });
});
