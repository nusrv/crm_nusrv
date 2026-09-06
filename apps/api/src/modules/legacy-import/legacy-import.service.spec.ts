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

function canonicalWorkbookFixture(): Buffer {
  const workbook = XLSX.utils.book_new();
  const sheet = (rows: unknown[][]) => XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(
    workbook,
    sheet([
      ['Customer_ID', 'Customer_Order', 'Canonical_Name', 'Review_Status'],
      ['CUST-0001', 1, 'Duplicate Signal Co', 'READY'],
      ['CUST-0002', 2, 'Clean Co', 'READY'],
    ]),
    'Customers',
  );
  XLSX.utils.book_append_sheet(
    workbook,
    sheet([['Contact_ID', 'Customer_ID', 'Person_Name', 'Role']]),
    'Contacts',
  );
  XLSX.utils.book_append_sheet(
    workbook,
    sheet([
      [
        'Phone_ID',
        'Customer_ID',
        'Contact_ID',
        'Phone_Type',
        'E164_Normalized',
        'Active',
        'Primary_Draft',
        'Verification_Status',
      ],
    ]),
    'Phone_Channels',
  );
  XLSX.utils.book_append_sheet(
    workbook,
    sheet([
      ['Email_ID', 'Customer_ID', 'Contact_ID', 'Normalized_Email', 'Role', 'Verification_Status'],
      ['EM-0001', 'CUST-0001', '', 'dup@example.test', 'GENERAL', 'UNVERIFIED'],
      ['EM-0002', 'CUST-0002', '', 'clean@example.test', 'GENERAL', 'UNVERIFIED'],
    ]),
    'Email_Channels',
  );
  XLSX.utils.book_append_sheet(
    workbook,
    sheet([
      [
        'Subscription_ID',
        'Source_Sequence',
        'Source_Row',
        'Customer_ID',
        'Billing_Entity_Source',
        'Service_Type_Source',
        'Package_Source',
        'Start_Date',
        'Current_Term_End_Date',
        'Renewal_Interval_Months',
        'Selling_Price_Original',
        'Currency',
        'Review_Status',
      ],
      [
        'SUB-0001',
        1,
        3,
        'CUST-0001',
        'Billing Co',
        'Hosting',
        'CUSTOM Plan',
        new Date('2026-01-01T00:00:00.000Z'),
        new Date('2027-01-01T00:00:00.000Z'),
        12,
        100,
        'JOD',
        'READY',
      ],
      [
        'SUB-0002',
        2,
        4,
        'CUST-0002',
        'Billing Co',
        'Hosting',
        'CUSTOM Plan',
        new Date('2026-01-01T00:00:00.000Z'),
        new Date('2027-01-01T00:00:00.000Z'),
        12,
        200,
        'JOD',
        'READY',
      ],
      [
        'SUB-0003',
        3,
        5,
        'CUST-0002',
        'Billing Co',
        'Domain',
        'CUSTOM Plan',
        new Date('2026-01-01T00:00:00.000Z'),
        new Date('2027-01-01T00:00:00.000Z'),
        12,
        50,
        'JOD',
        'READY',
      ],
    ]),
    'Subscriptions',
  );
  const output: unknown = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  if (Buffer.isBuffer(output)) return output;
  if (output instanceof Uint8Array) return Buffer.from(output);
  throw new Error('The XLSX writer returned an unexpected fixture type.');
}

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

  it('deletes an unapproved staging batch transactionally and audits the deletion', async () => {
    const batch = {
      id: 'batch-id',
      sourceFileName: 'legacy.xlsx',
      sourceFileHash: 'source-hash',
      status: 'STAGED',
      totalRows: 604,
      _count: { rows: 604 },
    };
    const tx = {
      legacyImportBatch: {
        findUnique: jest.fn(() => Promise.resolve(batch)),
        delete: jest.fn(() => Promise.resolve(batch)),
      },
      legacyImportRow: {
        count: jest.fn(() => Promise.resolve(0)),
        deleteMany: jest.fn(() => Promise.resolve({ count: 604 })),
      },
    };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const audit = {
      record: jest.fn<
        (
          event: { eventKey: string; subjectId?: string; metadata?: Record<string, unknown> },
          client?: unknown,
        ) => Promise<{ id: string }>
      >(() => Promise.resolve({ id: 'audit-id' })),
    };
    const service = new LegacyImportService(prisma as never, {} as never, audit as never);

    await expect(service.deleteBatch('batch-id', actor)).resolves.toEqual({
      id: 'batch-id',
      deleted: true,
      deletedRows: 604,
    });
    expect(tx.legacyImportRow.deleteMany).toHaveBeenCalledWith({
      where: { batchId: 'batch-id' },
    });
    expect(tx.legacyImportBatch.delete).toHaveBeenCalledWith({ where: { id: 'batch-id' } });
    expect(audit.record.mock.calls[0]?.[0]).toMatchObject({
      eventKey: 'legacy_import.batch_deleted',
      subjectId: 'batch-id',
      metadata: { deletedRows: 604 },
    });
    expect(audit.record.mock.calls[0]?.[1]).toBe(tx);
  });

  it('refuses to delete a batch containing approved or live-linked rows', async () => {
    const tx = {
      legacyImportBatch: {
        findUnique: jest.fn(() =>
          Promise.resolve({
            id: 'batch-id',
            sourceFileName: 'legacy.xlsx',
            sourceFileHash: 'source-hash',
            status: 'IN_REVIEW',
            totalRows: 604,
            _count: { rows: 604 },
          }),
        ),
        delete: jest.fn(),
      },
      legacyImportRow: {
        count: jest.fn(() => Promise.resolve(1)),
        deleteMany: jest.fn(),
      },
    };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const audit = { record: jest.fn() };
    const service = new LegacyImportService(prisma as never, {} as never, audit as never);

    await expect(service.deleteBatch('batch-id', actor)).rejects.toThrow(
      'contains approved or live-linked records',
    );
    expect(tx.legacyImportRow.deleteMany).not.toHaveBeenCalled();
    expect(tx.legacyImportBatch.delete).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
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
    const rateToJod = { mul: jest.fn(() => ({ toDecimalPlaces: () => '100.000' })) };
    const tx = {
      legacyImportRow: {
        findUnique: jest
          .fn<() => Promise<typeof readyRow | typeof approvedRow>>()
          .mockResolvedValueOnce(readyRow)
          .mockResolvedValueOnce(approvedRow),
        updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
        update: jest.fn(() => Promise.resolve({ ...readyRow, status: 'APPROVED' })),
      },
      customer: {
        create: jest.fn(() => Promise.resolve({ ...customer, contacts: [] })),
        findUnique: jest.fn(),
        findFirst: jest.fn(() => Promise.resolve(null)),
      },
      customerEmailAddress: { createMany: jest.fn(() => Promise.resolve({ count: 1 })) },
      customerPhoneNumber: { createMany: jest.fn(() => Promise.resolve({ count: 0 })) },
      subscription: { create: jest.fn(() => Promise.resolve(subscription)) },
      currency: {
        findUnique: jest.fn(() =>
          Promise.resolve({
            code: 'JOD',
            active: true,
            rateToJod,
            effectiveDate: new Date('2026-01-01'),
          }),
        ),
      },
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

  it('resolves two sibling canonical rows to the same customer instead of creating a duplicate', async () => {
    const canonicalCustomerRef = 'canonical.xlsx#Customers!CUST-0001';
    const buildRow = (id: string, subscriptionCode: string) => ({
      id,
      batchId: 'batch-id',
      status: LegacyImportRowStatus.READY_FOR_APPROVAL,
      sourceReference: `canonical.xlsx#Subscriptions!${subscriptionCode}`,
      customerResolution: LegacyCustomerResolution.CREATE_NEW,
      candidateCustomerId: null,
      mappedCustomer: {
        companyName: 'Canonical Customer',
        primaryEmail: 'canonical@example.test',
        billingEntityId: 'entity-id',
        preferredLanguage: 'en',
        sourceLegacyReference: canonicalCustomerRef,
      },
      mappedSubscriptions: [
        {
          serviceTypeId: 'service-type-id',
          name: 'Canonical Hosting',
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
    });
    const rowA = buildRow('row-a', 'SUB-0001');
    const rowB = buildRow('row-b', 'SUB-0002');
    const customer = { id: 'customer-id', contacts: [] };
    const rateToJod = { mul: jest.fn(() => ({ toDecimalPlaces: () => '100.000' })) };
    const tx = {
      legacyImportRow: {
        findUnique: jest
          .fn<() => Promise<typeof rowA>>()
          .mockResolvedValueOnce(rowA)
          .mockResolvedValueOnce(rowB),
        updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
        update: jest.fn(() => Promise.resolve({})),
      },
      customer: {
        create: jest.fn(() => Promise.resolve(customer)),
        findFirst: jest
          .fn<() => Promise<typeof customer | null>>()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(customer),
      },
      customerEmailAddress: { createMany: jest.fn(() => Promise.resolve({ count: 1 })) },
      customerPhoneNumber: { createMany: jest.fn(() => Promise.resolve({ count: 0 })) },
      subscription: {
        create: jest
          .fn<() => Promise<{ id: string }>>()
          .mockResolvedValueOnce({ id: 'subscription-a' })
          .mockResolvedValueOnce({ id: 'subscription-b' }),
      },
      currency: {
        findUnique: jest.fn(() =>
          Promise.resolve({
            code: 'JOD',
            active: true,
            rateToJod,
            effectiveDate: new Date('2026-01-01'),
          }),
        ),
      },
      legacyImportSubscriptionLink: { create: jest.fn(() => Promise.resolve({ id: 'link-id' })) },
    };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
      legacyImportRow: { count: jest.fn(() => Promise.resolve(0)) },
      legacyImportBatch: { update: jest.fn(() => Promise.resolve({ id: 'batch-id' })) },
    };
    const audit = { record: jest.fn(() => Promise.resolve({ id: 'audit-id' })) };
    const service = new LegacyImportService(prisma as never, {} as never, audit as never);

    const first = await service.approveRow('row-a', actor);
    const second = await service.approveRow('row-b', actor);

    expect(first).toEqual(expect.objectContaining({ customerId: 'customer-id' }));
    expect(second).toEqual(expect.objectContaining({ customerId: 'customer-id' }));
    expect(tx.customer.create).toHaveBeenCalledTimes(1);
    expect(tx.customer.findFirst).toHaveBeenCalledWith({
      where: { sourceLegacyReference: canonicalCustomerRef },
    });
    expect(tx.subscription.create).toHaveBeenCalledTimes(2);
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

  it("stages a canonical workbook: flags a shared email as a review signal without auto-merging, and shares one customer reference across a customer's multiple subscriptions", async () => {
    const existingCustomer = {
      id: 'existing-customer-id',
      customerCode: 'CUS-001',
      companyName: 'Existing Customer',
      primaryEmail: 'dup@example.test',
      secondaryEmail: null,
      phone: null,
      subscriptions: [],
    };
    const createdRows: Array<{ data: Record<string, unknown> }> = [];
    const tx = {
      legacyImportBatch: { create: jest.fn(() => Promise.resolve({ id: 'batch-id' })) },
      legacyImportRow: {
        create: jest.fn((input: { data: Record<string, unknown> }) => {
          createdRows.push(input);
          return Promise.resolve({ id: `row-${String(createdRows.length)}` });
        }),
      },
    };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
      legacyImportBatch: { findUnique: jest.fn(() => Promise.resolve(null)) },
      customer: { findMany: jest.fn(() => Promise.resolve([existingCustomer])) },
      billingEntity: {
        findMany: jest.fn(() => Promise.resolve([{ id: 'entity-id', name: 'Billing Co' }])),
      },
      serviceType: {
        findMany: jest.fn(() =>
          Promise.resolve([
            { id: 'hosting-id', name: 'Hosting' },
            { id: 'domain-id', name: 'Domain' },
          ]),
        ),
      },
      servicePackage: { findMany: jest.fn(() => Promise.resolve([])) },
    };
    const audit = { record: jest.fn(() => Promise.resolve({ id: 'audit-id' })) };
    const encryption = { encrypt: jest.fn(() => 'ciphertext') };
    const service = new LegacyImportService(prisma as never, encryption as never, audit as never);

    const buffer = canonicalWorkbookFixture();
    const result = await service.createBatch(
      { originalname: 'canonical.xlsx', size: buffer.length, buffer },
      actor,
    );

    expect(result.reused).toBe(false);
    expect(createdRows).toHaveLength(3);

    const duplicateRow = createdRows.find(
      (row) => row.data.sourceReference === 'canonical.xlsx#Subscriptions!SUB-0001',
    );
    expect(duplicateRow?.data.status).toBe(LegacyImportRowStatus.REQUIRES_MANUAL_REVIEW);
    expect(duplicateRow?.data.customerResolution).toBeUndefined();
    expect(String(duplicateRow?.data.validationIssues)).toMatch(/duplicate customer/i);

    const cleanRows = createdRows.filter((row) =>
      ['canonical.xlsx#Subscriptions!SUB-0002', 'canonical.xlsx#Subscriptions!SUB-0003'].includes(
        row.data.sourceReference as string,
      ),
    );
    expect(cleanRows).toHaveLength(2);
    const customerRefs = cleanRows.map(
      (row) => (row.data.mappedCustomer as { sourceLegacyReference: string }).sourceLegacyReference,
    );
    expect(customerRefs[0]).toBe('canonical.xlsx#Customers!CUST-0002');
    expect(customerRefs[0]).toBe(customerRefs[1]);

    // The canonical sheet gives Start Date / End Date / the renewal interval as typed columns,
    // not the free text the reused classifier normally parses them from — every staged row's
    // issue list must never claim they are "missing" just because that free text is absent.
    for (const row of createdRows) {
      expect(String(row.data.validationIssues)).not.toMatch(
        /Date column is missing or invalid|Renewal interval requires human confirmation/,
      );
    }

    // billingFrequency must be computed from the canonical sheet's own Renewal_Interval_Months
    // (here 12 -> ANNUAL), not from the reused classifier's free-text parsing, which never sees
    // any frequency text for a canonical row and would otherwise always leave it undefined —
    // silently producing a row nothing in the UI could fix, since only REQUIRES_MANUAL_REVIEW
    // rows show an editable form at all.
    for (const row of createdRows) {
      const subscriptions = row.data.mappedSubscriptions as Array<{ billingFrequency?: string }>;
      expect(subscriptions[0]?.billingFrequency).toBe(BillingFrequency.ANNUAL);
    }
  });
});
