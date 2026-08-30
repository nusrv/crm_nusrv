import { jest } from '@jest/globals';
import * as XLSX from '@e965/xlsx';
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
import { parseLegacyWorkbook } from './legacy-workbook.parser';

const actor = { actorId: '10000000-0000-4000-8000-000000000001' };

function explicitDateWorkbookFixture(): Buffer {
  const workbook = XLSX.utils.book_new();
  const rows: unknown[][] = [
    [
      'Start Date',
      'End Date',
      'Renewal date (-15days)',
      'Renewal Frequency',
      'Company Name',
      'E-mail Address',
      'Registration Type',
      'Package',
      'Billing Company',
      'Price JD',
      'Information',
    ],
    [
      new Date('2026-01-16T00:00:00Z'),
      new Date('2027-01-15T00:00:00Z'),
      new Date('2026-12-31T00:00:00Z'),
      '1 Year',
      'SAFE REIMPORT COMPANY',
      'safe-reimport@example.test',
      'Hosting',
      'PREMIUM PLAN',
      'New Serve for Digital Data Transformation',
      250,
      'Web Space 30GB; Mail Space 8GB; Monthly Transfer 250GB',
    ],
  ];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Active_Subscriptions');
  const output: unknown = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  if (Buffer.isBuffer(output)) return output;
  if (output instanceof Uint8Array) return Buffer.from(output);
  throw new Error('The XLSX writer returned an unexpected fixture type.');
}

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
  it('refreshes explicit dates in an untouched reused batch and remains idempotent', async () => {
    const buffer = explicitDateWorkbookFixture();
    const parsedRow = parseLegacyWorkbook(buffer, 'dated.xlsx')[0];
    expect(parsedRow).toBeDefined();
    const sourceFileHash = await import('node:crypto').then(({ createHash }) =>
      createHash('sha256').update(buffer).digest('hex'),
    );
    const existing = { id: 'batch-id', sourceFileHash, _count: { rows: 1 } };
    let persistedRow = {
      id: 'row-id',
      sheetName: 'Active_Subscriptions',
      sourceRowNumber: parsedRow!.sourceRowNumber,
      mappedSubscriptions: [
        {
          name: 'PREMIUM PLAN',
          startDate: null,
          renewalDate: null,
          classificationEvidence: { sourceRegistration: 'Hosting' },
        },
      ],
      validationIssues: [
        'Start date requires human confirmation; it is not safely normalized from free text.',
        'The source reminder-date column is preserved but the actual renewal date requires human confirmation.',
        'Package confirmation remains required.',
      ],
      validationStatus: 'INVALID',
    };
    const tx = {
      legacyImportRow: {
        findMany: jest.fn(() => Promise.resolve([persistedRow])),
        update: jest.fn((input: { data: Record<string, unknown> }) => {
          persistedRow = { ...persistedRow, ...input.data };
          return Promise.resolve(persistedRow);
        }),
      },
    };
    const prisma = {
      legacyImportBatch: { findUnique: jest.fn(() => Promise.resolve(existing)) },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const audit = {
      record: jest.fn<
        (
          event: { eventKey: string; metadata?: Record<string, unknown> },
          client?: unknown,
        ) => Promise<{
          id: string;
        }>
      >(() => Promise.resolve({ id: 'audit-id' })),
    };
    const service = new LegacyImportService(prisma as never, {} as never, audit as never);

    const first = await service.createBatch(
      { originalname: 'dated.xlsx', size: buffer.length, buffer },
      actor,
    );
    const second = await service.createBatch(
      { originalname: 'dated.xlsx', size: buffer.length, buffer },
      actor,
    );

    expect(first).toEqual({ batch: existing, reused: true, refreshedRows: 1 });
    expect(second).toEqual({ batch: existing, reused: true, refreshedRows: 0 });
    expect(tx.legacyImportRow.update).toHaveBeenCalledTimes(1);
    expect(persistedRow.mappedSubscriptions[0]).toEqual(
      expect.objectContaining({ startDate: '2026-01-16', renewalDate: '2027-01-15' }),
    );
    expect(persistedRow.validationIssues).toEqual(['Package confirmation remains required.']);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventKey: 'legacy_import.reimport_detected' }),
      tx,
    );
    expect(audit.record.mock.calls[0]?.[0].metadata).toMatchObject({
      refreshedRows: 1,
      preservedReviewedRows: true,
    });
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
