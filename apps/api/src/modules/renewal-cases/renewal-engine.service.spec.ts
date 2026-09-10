import { jest } from '@jest/globals';
import { RenewalCaseStatus } from '../../generated/prisma/enums';
import { BusinessTimeService } from '../../time/business-time.service';
import { RenewalEngineService } from './renewal-engine.service';
import { RenewalTemplateRenderer } from './renewal-template.renderer';

// Focused, single-scenario unit test: a customer with normalized email channel data but no active
// primary channel must never receive a queued CommunicationOutbox row, even though its subscription
// is otherwise fully eligible for a D-30 reminder today.
describe('RenewalEngineService — authoritative recipient resolution', () => {
  it('does not queue a customer reminder, and does not fall back to the scalar, when the resolver finds no valid recipient', async () => {
    const asOf = new Date('2026-08-24T08:00:00.000Z');
    const businessTime = new BusinessTimeService({ getOrThrow: () => 'Asia/Amman' } as never);

    const subscription = {
      id: 'subscription-id',
      customerId: 'customer-id',
      startDate: new Date('2026-01-24T00:00:00.000Z'),
      renewalDate: businessTime.addBusinessDays(asOf, 30),
      billingFrequency: 'ANNUAL',
      renewalIntervalMonths: 12,
      name: 'Hosting Plan',
      description: 'Hosting Plan',
      sellingPrice: { toFixed: () => '100.000' },
      currency: 'JOD',
      customer: {
        id: 'customer-id',
        // The scalar is deliberately populated here — proving the engine does NOT fall back to it.
        primaryEmail: 'stale-scalar@example.test',
        contactName: 'Contact',
        nameEn: 'Customer Co',
        nameAr: null,
        status: 'ACTIVE',
        billingEntity: { name: 'Billing Entity' },
      },
      serviceType: { name: 'Hosting' },
    };

    const renewalCase = {
      id: 'case-id',
      status: RenewalCaseStatus.UPCOMING,
      holds: [],
    };

    const communicationOutboxCreate = jest.fn();
    const tx = {
      renewalCase: { create: jest.fn(() => Promise.resolve(renewalCase)) },
      communicationOutbox: { create: communicationOutboxCreate },
    };
    const auditRecord = jest.fn(() => Promise.resolve({ id: 'audit-id' }));
    const prisma = {
      reminderRule: {
        findMany: jest.fn(() =>
          Promise.resolve([
            {
              id: 'rule-30',
              daysBeforeDue: 30,
              template: {
                enabled: true,
                subjectTemplate: 'Renewal for {{subscriptionName}}',
                bodyTemplate: 'Hi {{customerCompany}}',
              },
            },
          ]),
        ),
      },
      notificationRule: { findMany: jest.fn(() => Promise.resolve([])) },
      subscription: { findMany: jest.fn(() => Promise.resolve([subscription])) },
      renewalCase: {
        findUniqueOrThrow: jest.fn(() => Promise.resolve(renewalCase)),
        updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
      },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const emailResolution = {
      resolvePrimaryRecipient: jest.fn(() => Promise.resolve(null)),
    };

    const engine = new RenewalEngineService(
      prisma as never,
      { record: auditRecord } as never,
      businessTime,
      { now: () => asOf },
      new RenewalTemplateRenderer(),
      emailResolution as never,
    );

    const summary = await engine.evaluateAll({ asOf, trigger: 'manual' });

    expect(emailResolution.resolvePrimaryRecipient).toHaveBeenCalledWith('customer-id');
    // No CommunicationOutbox row was ever created for this reminder.
    expect(communicationOutboxCreate).not.toHaveBeenCalled();
    expect(summary.customerRemindersQueued).toBe(0);
    expect(summary.customerRemindersSkippedNoRecipient).toBe(1);
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({ eventKey: 'renewal.reminder.skipped.no_recipient' }),
    );
  });
});
