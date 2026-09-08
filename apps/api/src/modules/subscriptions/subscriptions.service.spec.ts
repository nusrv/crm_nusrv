import { jest } from '@jest/globals';
import { SubscriptionsService } from './subscriptions.service';

describe('SubscriptionsService.list filters', () => {
  it('filters by Service Type, package, Billing Entity, currency, and renewal date range', async () => {
    const findMany = jest.fn<(input: { where: Record<string, unknown> }) => Promise<never[]>>(() =>
      Promise.resolve([]),
    );
    const prisma = {
      subscription: { findMany, count: jest.fn(() => Promise.resolve(0)) },
    };
    const service = new SubscriptionsService(prisma as never, {} as never);

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
    const service = new SubscriptionsService(prisma as never, {} as never);

    await service.list({ page: 1, pageSize: 20 });

    expect(findMany.mock.calls[0]?.[0].where).not.toHaveProperty('customer');
  });
});
