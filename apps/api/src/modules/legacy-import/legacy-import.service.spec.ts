import { jest } from '@jest/globals';
import {
  BillingFrequency,
  LegacyCustomerResolution,
  LegacyImportRowStatus,
} from '../../generated/prisma/enums';
import {
  isActiveSubscriptionSheet,
  LegacyImportService,
  OUT_OF_SCOPE_REASON,
} from './legacy-import.service';

const actor = { actorId: '10000000-0000-4000-8000-000000000001' };

describe('LegacyImportService', () => {
  it('keeps all workbook rows traceable while limiting review to Active_Subscriptions', () => {
    const sheets = [
      ...Array.from({ length: 214 }, () => 'Active_Subscriptions'),
      ...Array.from({ length: 388 }, () => 'Suspended_Subscriptions'),
      'Sheet3',
      'Sheet4',
    ];
    const active = sheets.filter(isActiveSubscriptionSheet);
    const skipped = sheets.filter((sheet) => !isActiveSubscriptionSheet(sheet));

    expect(active).toHaveLength(214);
    expect(skipped).toHaveLength(390);
    expect(OUT_OF_SCOPE_REASON).toContain('excluded from the active-subscription migration scope');
  });
  it('reuses an existing file-hash batch instead of staging duplicate rows', async () => {
    const existing = { id: 'batch-id', sourceFileHash: 'known', _count: { rows: 12 } };
    const prisma = {
      legacyImportBatch: { findUnique: jest.fn(() => Promise.resolve(existing)) },
    };
    const audit = {
      record: jest.fn<(event: { eventKey: string }, client?: unknown) => Promise<{ id: string }>>(
        () => Promise.resolve({ id: 'audit-id' }),
      ),
    };
    const service = new LegacyImportService(prisma as never, {} as never, audit as never);
    const buffer = Buffer.from('same workbook');
    const hash = await import('node:crypto').then(({ createHash }) =>
      createHash('sha256').update(buffer).digest('hex'),
    );
    existing.sourceFileHash = hash;

    const result = await service.createBatch(
      { originalname: 'legacy.xls', size: buffer.length, buffer },
      actor,
    );

    expect(result).toEqual({ batch: existing, reused: true });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventKey: 'legacy_import.reimport_detected' }),
    );
  });

  it('approves validated staging into traceable live records and is repeat-safe', async () => {
    const readyRow = {
      id: 'row-id',
      batchId: 'batch-id',
      status: LegacyImportRowStatus.READY_FOR_APPROVAL,
      sourceReference: 'legacy.xls#Active!2',
      customerResolution: LegacyCustomerResolution.CREATE_NEW,
      candidateCustomerId: null,
      mappedCustomer: {
        companyName: 'Legacy Customer',
        primaryEmail: 'legacy@example.test',
        billingEntityId: 'entity-id',
        preferredLanguage: 'en',
      },
      mappedSubscriptions: [
        {
          serviceTypeId: 'service-type-id',
          name: 'Legacy Hosting',
          startDate: '2026-01-01',
          renewalDate: '2027-01-01',
          billingFrequency: BillingFrequency.ANNUAL,
          sellingPrice: '100.000',
          currency: 'JOD',
          providerAutoRenews: true,
          graceHours: 24,
          status: 'ACTIVE',
        },
      ],
      subscriptionLinks: [],
    };
    const approvedRow = {
      ...readyRow,
      status: LegacyImportRowStatus.APPROVED,
      approvedCustomerId: 'customer-id',
      subscriptionLinks: [{ subscription: { id: 'subscription-id' } }],
    };
    const customer = { id: 'customer-id', companyName: 'Legacy Customer' };
    const subscription = { id: 'subscription-id', name: 'Legacy Hosting' };
    const tx = {
      legacyImportRow: {
        findUnique: jest
          .fn<() => Promise<typeof readyRow | typeof approvedRow>>()
          .mockResolvedValueOnce(readyRow)
          .mockResolvedValueOnce(approvedRow),
        updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
        update: jest.fn(() => Promise.resolve({ ...readyRow, status: 'APPROVED' })),
      },
      customer: { create: jest.fn(() => Promise.resolve(customer)), findUnique: jest.fn() },
      subscription: { create: jest.fn(() => Promise.resolve(subscription)) },
      legacyImportSubscriptionLink: { create: jest.fn(() => Promise.resolve({ id: 'link-id' })) },
    };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
      legacyImportRow: { count: jest.fn(() => Promise.resolve(0)) },
      legacyImportBatch: { update: jest.fn(() => Promise.resolve({ id: 'batch-id' })) },
    };
    const audit = {
      record: jest.fn<(event: { eventKey: string }, client?: unknown) => Promise<{ id: string }>>(
        () => Promise.resolve({ id: 'audit-id' }),
      ),
    };
    const service = new LegacyImportService(prisma as never, {} as never, audit as never);

    const first = await service.approveRow('row-id', actor);
    const second = await service.approveRow('row-id', actor);

    expect(first).toEqual(expect.objectContaining({ customerId: 'customer-id', reused: false }));
    expect(second).toEqual(expect.objectContaining({ customerId: 'customer-id', reused: true }));
    expect(tx.customer.create).toHaveBeenCalledTimes(1);
    expect(tx.subscription.create).toHaveBeenCalledTimes(1);
    expect(tx.legacyImportSubscriptionLink.create).toHaveBeenCalledWith({
      data: { importRowId: 'row-id', subscriptionId: 'subscription-id' },
    });
    expect(audit.record.mock.calls.map((call) => call[0])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventKey: 'legacy_import.live_customer_created' }),
        expect.objectContaining({ eventKey: 'legacy_import.live_subscription_created' }),
        expect.objectContaining({ eventKey: 'legacy_import.row_approved' }),
      ]),
    );
  });

  it('refuses approval while a row still requires manual review', async () => {
    const tx = {
      legacyImportRow: {
        findUnique: jest.fn(() =>
          Promise.resolve({ id: 'row-id', status: LegacyImportRowStatus.REQUIRES_MANUAL_REVIEW }),
        ),
      },
    };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = new LegacyImportService(prisma as never, {} as never, {} as never);
    await expect(service.approveRow('row-id', actor)).rejects.toThrow(
      'must be validated before approval',
    );
  });
});
