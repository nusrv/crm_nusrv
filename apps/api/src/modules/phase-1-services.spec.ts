import { jest } from '@jest/globals';
import { BillingFrequency, CustomerStatus, SubscriptionStatus } from '../generated/prisma/enums';
import { ServiceTypesService } from './service-types/service-types.service';
import { SubscriptionsService } from './subscriptions/subscriptions.service';

describe('Phase 1 audited services', () => {
  it('creates configurable Service Types without code changes and emits an audit event', async () => {
    const serviceType = {
      id: 'type-id',
      code: 'EMAIL',
      name: 'Email',
      _count: { subscriptions: 0 },
    };
    const tx = { serviceType: { create: jest.fn(() => Promise.resolve(serviceType)) } };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const audit = { record: jest.fn(() => Promise.resolve({ id: 'audit-id' })) };
    const service = new ServiceTypesService(prisma as never, audit as never);
    await expect(
      service.create({ code: 'EMAIL', name: 'Email' }, { actorId: 'actor-id' }),
    ).resolves.toBe(serviceType);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventKey: 'service_type.created' }),
      tx,
    );
  });

  it('creates an independent subscription under the selected customer and Service Type', async () => {
    const rateToJod = { mul: jest.fn(() => ({ toDecimalPlaces: () => '100.000' })) };
    const subscription = {
      id: 'subscription-id',
      customerId: 'customer-id',
      serviceTypeId: 'type-id',
      subscriptionCode: 'SUB-001',
      sellingPrice: { toString: () => '100.000' },
      currencyDefinition: { rateToJod, effectiveDate: new Date('2026-08-31') },
    };
    const createSubscription = jest.fn<
      (input: {
        data: { customerId: string; serviceTypeId: string };
      }) => Promise<typeof subscription>
    >(() => Promise.resolve(subscription));
    const tx = { subscription: { create: createSubscription } };
    const prisma = {
      customer: { findUnique: jest.fn(() => Promise.resolve({ status: CustomerStatus.ACTIVE })) },
      serviceType: { findUnique: jest.fn(() => Promise.resolve({ active: true })) },
      currency: {
        findUnique: jest.fn(() =>
          Promise.resolve({
            code: 'JOD',
            active: true,
            rateToJod,
            effectiveDate: new Date('2026-08-31'),
          }),
        ),
      },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const audit = { record: jest.fn(() => Promise.resolve({ id: 'audit-id' })) };
    const service = new SubscriptionsService(prisma as never, audit as never);

    await service.create(
      {
        customerId: 'customer-id',
        serviceTypeId: 'type-id',
        subscriptionCode: 'SUB-001',
        name: 'Hosting',
        startDate: '2026-01-01',
        renewalDate: '2027-01-01',
        billingFrequency: BillingFrequency.ANNUAL,
        sellingPrice: '100.000',
        currency: 'JOD',
        providerAutoRenews: true,
        graceHours: 24,
        status: SubscriptionStatus.ACTIVE,
      },
      { actorId: 'actor-id' },
    );

    const createInput = createSubscription.mock.calls[0]?.[0];
    expect(createInput?.data.customerId).toBe('customer-id');
    expect(createInput?.data.serviceTypeId).toBe('type-id');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventKey: 'subscription.created' }),
      tx,
    );
  });
});
