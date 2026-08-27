import { jest } from '@jest/globals';
import {
  BillingFrequency,
  CustomerStatus,
  PackageKind,
  SubscriptionIdentifierType,
  SubscriptionStatus,
} from '../../generated/prisma/enums';
import { SubscriptionsService } from './subscriptions.service';

describe('Phase 2.1 subscription package snapshots', () => {
  it('copies catalog identity/specification but preserves the actual selling price and term', async () => {
    const created = { id: 'subscription-id' };
    type CreateArgs = { data: Record<string, unknown> };
    const create = jest.fn<(input: CreateArgs) => Promise<typeof created>>(() =>
      Promise.resolve(created),
    );
    const tx = { subscription: { create } };
    const prisma = {
      customer: { findUnique: jest.fn(() => Promise.resolve({ status: CustomerStatus.ACTIVE })) },
      serviceType: { findUnique: jest.fn(() => Promise.resolve({ active: true })) },
      servicePackage: {
        findUnique: jest.fn(() =>
          Promise.resolve({
            id: 'package-id',
            code: 'HOSTING_PREMIUM',
            name: 'PREMIUM PLAN',
            kind: PackageKind.STANDARD,
            specifications: { webSpaceGb: 30, mailSpaceGb: 8 },
            serviceTypeId: 'type-id',
            active: true,
          }),
        ),
      },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
        Promise.resolve(callback(tx)),
      ),
    };
    const audit = { record: jest.fn(() => Promise.resolve(undefined)) };
    const service = new SubscriptionsService(prisma as never, audit as never);

    await service.create(
      {
        customerId: 'customer-id',
        serviceTypeId: 'type-id',
        servicePackageId: 'package-id',
        subscriptionCode: 'SUB-P21',
        name: 'Negotiated Premium',
        startDate: '2026-01-01',
        renewalDate: '2029-01-01',
        billingFrequency: BillingFrequency.CUSTOM,
        renewalIntervalMonths: 36,
        contractTermMonths: 36,
        sellingPrice: '499.125',
        currency: 'JOD',
        providerAutoRenews: true,
        graceHours: 24,
        status: SubscriptionStatus.ACTIVE,
        priceOverrideReason: 'Historical negotiated price',
        identifiers: [{ type: SubscriptionIdentifierType.DOMAIN, value: 'example.test' }],
      },
      { actorId: 'actor-id' },
    );

    const data = create.mock.calls[0]?.[0].data;
    expect(data).toMatchObject({
      servicePackageId: 'package-id',
      packageNameSnapshot: 'PREMIUM PLAN',
      packageSpecificationsSnapshot: { webSpaceGb: 30, mailSpaceGb: 8 },
      sellingPrice: '499.125',
      renewalIntervalMonths: 36,
      priceOverrideReason: 'Historical negotiated price',
      identifiers: { create: [{ type: SubscriptionIdentifierType.DOMAIN, value: 'example.test' }] },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventKey: 'subscription.created' }),
      tx,
    );
  });
});
