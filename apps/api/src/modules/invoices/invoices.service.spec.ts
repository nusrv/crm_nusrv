import { jest } from '@jest/globals';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { InvoiceStatus, SubscriptionStatus } from '../../generated/prisma/enums';
import { InvoicesService } from './invoices.service';

const amount = (value: string) => ({ toString: () => value });
const context = { actorId: 'user-1', ipAddress: '127.0.0.1' };

function invoice(overrides: Record<string, unknown> = {}) {
  return {
    id: 'invoice-1',
    customerId: 'customer-1',
    billingEntityId: 'entity-1',
    sourceSubscriptionId: 'subscription-1',
    status: InvoiceStatus.DRAFT,
    internalReference: 'NS-INV-2026-000001',
    invoiceCounter: 1n,
    submissionUuid: 'd0fe13c4-94a8-4b4d-88c2-a92204b58717',
    invoiceTypeName: '022',
    issuerCountryCodeSnapshot: 'JO',
    buyerCountryCodeSnapshot: 'JO',
    selectedConnectionId: null,
    submissionLock: null,
    cancellationReason: null,
    cancelledBy: null,
    cancelledAt: null,
    reconciliationRequired: false,
    reconciledAt: null,
    reconciledBy: null,
    reconciliationNote: null,
    officializationProvenance: null,
    activeDraftKey: 'subscription-1:2026-01-01:2027-01-01',
    invoiceDate: new Date('2026-11-17'),
    currencyCode: 'JOD',
    periodStart: new Date('2026-01-01'),
    periodEnd: new Date('2027-01-01'),
    customerCodeSnapshot: 'NS0001',
    customerNameEnSnapshot: 'Original Customer',
    customerNameArSnapshot: null,
    customerAddressSnapshot: 'Original Address',
    customerCountrySnapshot: 'Jordan',
    customerPhoneSnapshot: '+962700000000',
    customerTaxNumberSnapshot: '33445544',
    issuerCodeSnapshot: 'NS',
    issuerLegalNameSnapshot: 'New Serve',
    issuerLegalNameArSnapshot: null,
    issuerTaxNumberSnapshot: '12345678',
    issuerAddressSnapshot: 'Issuer Address',
    issuerInvoiceEmailSnapshot: 'billing@example.com',
    issuerBankDetailsSnapshot: null,
    subtotal: amount('100.000'),
    discountTotal: amount('0.000'),
    taxTotal: amount('16.000'),
    grandTotal: amount('116.000'),
    fawtaraStatus: null,
    fawtaraInvoiceNumber: null,
    fawtaraInvoiceUuid: null,
    fawtaraQrPayload: null,
    fawtaraQrImageDataUrl: null,
    fawtaraSubmittedAt: null,
    fawtaraAcceptedAt: null,
    latestFawtaraMessage: null,
    latestFawtaraResultJson: null,
    officialCurrencyCode: null,
    officialSubtotal: null,
    officialDiscountTotal: null,
    officialTaxTotal: null,
    officialGrandTotal: null,
    officializationNote: null,
    createdAt: new Date('2026-11-17'),
    updatedAt: new Date('2026-11-17'),
    customer: {
      id: 'customer-1',
      customerCode: 'NS0001',
      nameEn: 'Original Customer',
      nameAr: null,
    },
    billingEntity: { id: 'entity-1', code: 'NS', name: 'New Serve', active: true },
    sourceSubscription: {
      id: 'subscription-1',
      subscriptionCode: 'NS0001-S01',
      name: 'Hosting',
      status: SubscriptionStatus.ACTIVE,
    },
    lines: [
      {
        id: 'line-1',
        invoiceId: 'invoice-1',
        sourceSubscriptionId: 'subscription-1',
        position: 1,
        description: 'Hosting',
        quantity: amount('1.000'),
        unitPrice: amount('100.000'),
        discountAmount: amount('0.000'),
        taxCategoryCode: 'S',
        taxRate: amount('16.0000'),
        lineSubtotal: amount('100.000'),
        taxAmount: amount('16.000'),
        lineTotal: amount('116.000'),
        serviceTypeSnapshot: 'Hosting',
        packageSnapshot: 'Managed Hosting',
        serviceSnapshotText: 'Hosting',
        identifiersSnapshotJson: [{ type: 'DOMAIN', value: 'example.com' }],
        periodStart: new Date('2026-01-01'),
        periodEnd: new Date('2027-01-01'),
        createdAt: new Date('2026-11-17'),
        updatedAt: new Date('2026-11-17'),
      },
    ],
    ...overrides,
  };
}

function subscription(status: SubscriptionStatus = SubscriptionStatus.ACTIVE) {
  return {
    id: 'subscription-1',
    customerId: 'customer-1',
    status,
    name: 'Managed Hosting',
    description: 'Annual managed hosting',
    startDate: new Date('2026-01-01'),
    renewalDate: new Date('2027-01-01'),
    currentTermEndDate: new Date('2027-01-01'),
    sellingPrice: amount('100.000'),
    currency: 'JOD',
    customer: {
      status: 'ACTIVE',
      customerCode: 'NS0001',
      nameEn: 'Original Customer',
      nameAr: null,
      address: 'Original Address',
      country: 'Jordan',
      phone: null,
      taxNumber: 'CUSTOMER-TAX',
      phoneNumbers: [{ phoneNumber: '+962700000000' }],
      billingEntity: {
        id: 'entity-1',
        code: 'NS',
        legalName: 'New Serve',
        taxNumber: 'ISSUER-TAX',
        address: 'Issuer Address',
        invoiceEmail: 'billing@example.com',
      },
    },
    serviceType: { name: 'Hosting' },
    servicePackage: { name: 'Managed Hosting' },
    packageNameSnapshot: 'Managed Hosting',
    identifiers: [{ type: 'DOMAIN', value: 'example.com', label: null }],
  };
}

function serviceWith(prisma: Record<string, unknown>, preflight = { validate: jest.fn() }) {
  const audit = {
    record: jest.fn<(event: unknown, transaction?: unknown) => Promise<{ id: string }>>(() =>
      Promise.resolve({ id: 'audit-1' }),
    ),
  };
  const service = new InvoicesService(
    {
      joFotaraConnection: {
        findFirst: jest.fn(() =>
          Promise.resolve({
            id: 'conn-1',
            billingEntityId: 'entity-1',
            enabled: true,
            incomeSourceSequence: '123',
            clientIdCiphertext: 'encrypted',
            secretKeyCiphertext: 'encrypted',
            productionSubmissionEnabled: false,
          }),
        ),
      },
      ...(prisma as object),
    } as never,
    audit as never,
    { now: () => new Date('2026-11-17T10:00:00.000Z') },
    { businessDate: () => new Date('2026-11-17') } as never,
    preflight as never,
  );
  return { service, audit };
}

describe('InvoicesService creation', () => {
  function harness(source = subscription()) {
    let persisted = invoice();
    const create = jest.fn((input: { data: Record<string, unknown> }) => {
      const data = input.data;
      const nested = data.lines as {
        create: Record<string, unknown> | Array<Record<string, unknown>>;
      };
      const createdLines = Array.isArray(nested.create) ? nested.create : [nested.create];
      persisted = invoice({
        ...data,
        lines: createdLines.map((line, index) => ({
          id: `line-${index + 1}`,
          invoiceId: 'invoice-1',
          ...line,
        })),
      });
      return Promise.resolve(persisted);
    });
    const tx = {
      billingEntity: { update: jest.fn(() => Promise.resolve({ lastInvoiceCounter: 1n })) },
      invoiceSequence: {
        upsert: jest.fn(() => Promise.resolve({ year: 2026, lastValue: 1 })),
      },
      invoice: { create },
    };
    const prisma = {
      subscription: { findUnique: jest.fn(() => Promise.resolve(source)) },
      invoice: { findUnique: jest.fn(() => Promise.resolve(null)) },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    return { ...serviceWith(prisma), create, prisma, getPersisted: () => persisted };
  }

  it('creates and audits a persisted snapshot from an ACTIVE subscription', async () => {
    const { service, create, audit } = harness();
    const result = await service.createFromSubscription('subscription-1', context);

    expect(result.status).toBe(InvoiceStatus.DRAFT);
    expect(result.customerNameEnSnapshot).toBe('Original Customer');
    expect(result.lines[0]?.description).toBe('Annual managed hosting');
    expect(result.lines[0]?.taxRate).toBeNull();
    expect(create).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining<Record<string, unknown>>({
        eventKey: 'invoice.created_from_subscription',
      }),
      expect.anything(),
    );
  });

  it('rejects every non-ACTIVE subscription on the server', async () => {
    const { service } = harness(subscription(SubscriptionStatus.SUSPENDED));
    await expect(service.createFromSubscription('subscription-1', context)).rejects.toThrow(
      'only be created from an ACTIVE subscription',
    );
  });

  it('does not change its persisted snapshot when the source objects later change', async () => {
    const source = subscription();
    const { service, getPersisted } = harness(source);
    await service.createFromSubscription('subscription-1', context);
    source.customer.nameEn = 'Changed Customer';
    source.sellingPrice = amount('999.000');

    expect(getPersisted().customerNameEnSnapshot).toBe('Original Customer');
    expect(getPersisted().lines[0]?.unitPrice.toString()).toBe('100.000');
  });

  it('blocks a simultaneous DRAFT/READY invoice for the same subscription period', async () => {
    const { service, prisma } = harness();
    (
      prisma.invoice as {
        findUnique: { mockResolvedValueOnce(value: unknown): unknown };
      }
    ).findUnique.mockResolvedValueOnce(invoice({ internalReference: 'NS-INV-2026-000009' }));
    await expect(service.createFromSubscription('subscription-1', context)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe('InvoicesService draft/preflight transitions', () => {
  it('recalculates draft line and invoice totals on the server', async () => {
    const old = invoice();
    let updatedData: Record<string, unknown> = {};
    const tx = {
      invoiceLine: { deleteMany: jest.fn(() => Promise.resolve({ count: 1 })) },
      invoice: {
        updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
        update: jest.fn((input: { data: Record<string, unknown> }) => {
          updatedData = input.data;
          const lineCreate = (input.data.lines as { create: Array<Record<string, unknown>> })
            .create;
          return Promise.resolve(
            invoice({
              ...input.data,
              lines: lineCreate.map((line, index) => ({
                id: `new-${index}`,
                invoiceId: old.id,
                ...line,
              })),
            }),
          );
        }),
      },
    };
    const prisma = {
      invoice: { findUnique: jest.fn(() => Promise.resolve(old)) },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const { service } = serviceWith(prisma);

    await service.updateDraft(
      old.id,
      {
        lines: [
          {
            description: 'Hosting',
            quantity: '2',
            unitPrice: '50',
            discountAmount: '10',
            taxCategoryCode: 'S',
            taxRate: '16',
          },
        ],
      },
      context,
    );

    expect(updatedData).toEqual(
      expect.objectContaining<Record<string, unknown>>({
        subtotal: '90.000',
        discountTotal: '10.000',
        taxTotal: '14.400',
        grandTotal: '104.400',
      }),
    );
  });

  it('cannot mark READY when any blocking preflight check fails', async () => {
    const old = invoice();
    const preflight = { validate: jest.fn(() => ({ valid: false, checks: [] })) };
    const { service } = serviceWith(
      { invoice: { findUnique: jest.fn(() => Promise.resolve(old)) } },
      preflight,
    );
    await expect(service.markReady(old.id, context)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('marks a valid draft READY and audits the transition', async () => {
    const old = invoice();
    const ready = invoice({ status: InvoiceStatus.READY_FOR_FAWTARA });
    const tx = {
      invoice: {
        updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
        findUniqueOrThrow: jest.fn(() => Promise.resolve(ready)),
      },
    };
    const prisma = {
      invoice: { findUnique: jest.fn(() => Promise.resolve(old)) },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const { service, audit } = serviceWith(prisma, {
      validate: jest.fn(() => ({ valid: true, checks: [] })),
    });
    const result = await service.markReady(old.id, context);
    expect(result.status).toBe(InvoiceStatus.READY_FOR_FAWTARA);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining<Record<string, unknown>>({
        eventKey: 'invoice.marked_ready_for_fawtara',
      }),
      tx,
    );
  });
});

describe('InvoicesService manual JoFotara officialization', () => {
  it('refuses to officialize a plain DRAFT invoice', async () => {
    const { service } = serviceWith({
      invoice: { findUnique: jest.fn(() => Promise.resolve(invoice())) },
    });
    await expect(
      service.recordFawtaraResult(
        'invoice-1',
        {
          fawtaraStatus: 'SUBMITTED',
          invoiceNumber: 'EINV-1',
          acceptedAt: '2026-11-17T10:00:00.000Z',
          qrPayload: 'official-payload',
        },
        context,
      ),
    ).rejects.toThrow('Only a READY_FOR_FAWTARA invoice can be officialized');
  });

  it('persists official number, UUID, QR and values, locks the invoice, and audits discrepancies', async () => {
    const ready = invoice({ status: InvoiceStatus.READY_FOR_FAWTARA });
    let updateData: Record<string, unknown> = {};
    const tx = {
      invoice: {
        updateMany: jest.fn((input: { data: Record<string, unknown> }) => {
          updateData = input.data;
          return Promise.resolve({ count: 1 });
        }),
        findUniqueOrThrow: jest.fn(() =>
          Promise.resolve(
            invoice({
              ...updateData,
              status: InvoiceStatus.FAWTARA_ACCEPTED,
              officialGrandTotal: amount('117.000'),
            }),
          ),
        ),
      },
    };
    const prisma = {
      invoice: { findUnique: jest.fn(() => Promise.resolve(ready)) },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const { service, audit } = serviceWith(prisma);

    const result = await service.recordFawtaraResult(
      ready.id,
      {
        fawtaraStatus: 'SUBMITTED',
        invoiceNumber: 'EINV-1',
        invoiceUuid: 'official-uuid',
        qrPayload: 'official-qr-payload',
        qrImageDataUrl:
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jPZkAAAAASUVORK5CYII=',
        acceptedAt: '2026-11-17T10:00:00.000Z',
        officialCurrencyCode: 'JOD',
        officialGrandTotal: '117.000',
      },
      context,
    );

    expect(updateData).toEqual(
      expect.objectContaining<Record<string, unknown>>({
        status: InvoiceStatus.FAWTARA_ACCEPTED,
        activeDraftKey: null,
        fawtaraInvoiceNumber: 'EINV-1',
        fawtaraInvoiceUuid: 'official-uuid',
        fawtaraQrPayload: 'official-qr-payload',
      }),
    );
    expect(result.locked).toBe(true);
    expect(result.effectiveGrandTotal.toString()).toBe('117.000');
    expect(result.officialValueDiscrepancies).toEqual(
      expect.arrayContaining([
        expect.objectContaining<Record<string, unknown>>({ field: 'grandTotal' }),
      ]),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining<Record<string, unknown>>({
        eventKey: 'invoice.fawtara_result_recorded',
      }),
      tx,
    );
    expect(JSON.stringify(audit.record.mock.calls[0]?.[0])).toContain('"source":"MANUAL"');
  });

  it('keeps an accepted invoice locked against draft edits', async () => {
    const { service } = serviceWith({
      invoice: {
        findUnique: jest.fn(() =>
          Promise.resolve(invoice({ status: InvoiceStatus.FAWTARA_ACCEPTED })),
        ),
      },
    });
    await expect(service.updateDraft('invoice-1', {}, context)).rejects.toThrow(
      'Only a DRAFT invoice can be edited',
    );
  });
});

describe('Invoice hardening', () => {
  function harness(current = invoice()) {
    let persisted = current;
    const tx = {
      invoice: {
        updateMany: jest.fn((args: { data: Record<string, unknown> }) => {
          persisted = invoice({ ...persisted, ...args.data });
          return Promise.resolve({ count: 1 });
        }),
        findUniqueOrThrow: jest.fn(() => Promise.resolve(persisted)),
      },
    };
    const { service, audit } = serviceWith({
      invoice: { findUnique: jest.fn(() => Promise.resolve(persisted)) },
      $transaction: (cb: (client: typeof tx) => unknown) => cb(tx),
    });
    return { service, audit, tx, get: () => persisted };
  }
  it('cancels a draft, retains history and releases duplicate guard', async () => {
    const h = harness();
    const result = await h.service.cancelDraft('invoice-1', 'Created by mistake', context);
    expect(result.status).toBe('CANCELLED');
    expect(result.activeDraftKey).toBeNull();
    expect(result.finalPrintEnabled).toBe(false);
    expect(h.audit.record).toHaveBeenCalledWith(
      expect.objectContaining<Record<string, unknown>>({
        eventKey: 'invoice.draft_cancelled',
        newState: expect.objectContaining<Record<string, unknown>>({
          cancellationReason: 'Created by mistake',
        }),
      }),
      h.tx,
    );
  });
  it('requires a cancellation reason', async () => {
    await expect(harness().service.cancelDraft('invoice-1', '  ', context)).rejects.toThrow(
      'reason',
    );
  });
  it.each(['FAWTARA_ACCEPTED', 'READY_FOR_FAWTARA', 'CANCELLED'] as const)(
    'cannot cancel %s',
    async (status) => {
      await expect(
        harness(invoice({ status })).service.cancelDraft('invoice-1', 'Mistake', context),
      ).rejects.toThrow('Only a DRAFT');
    },
  );
  it('manual payload alone cannot officialize', async () => {
    await expect(
      harness(invoice({ status: 'READY_FOR_FAWTARA' })).service.recordFawtaraResult(
        'invoice-1',
        {
          fawtaraStatus: 'SUBMITTED',
          invoiceNumber: 'EINV-1',
          qrPayload: 'raw',
          acceptedAt: '2026-11-17',
        },
        context,
      ),
    ).rejects.toThrow('graphical QR');
  });
  it('requires an explicit reason to reconcile', async () => {
    await expect(harness().service.reconcile('invoice-1', '', context)).rejects.toThrow('note');
  });
  it('audits reconciliation without rewriting draft amounts', async () => {
    const h = harness(
      invoice({
        status: 'FAWTARA_ACCEPTED',
        reconciliationRequired: true,
        officialGrandTotal: amount('117.000'),
        fawtaraQrImageDataUrl: 'data:image/png;base64,aA==',
      }),
    );
    const result = await h.service.reconcile(
      'invoice-1',
      'Reviewed against official result',
      context,
    );
    expect(result.grandTotal.toString()).toBe('116.000');
    expect(result.officialGrandTotal?.toString()).toBe('117.000');
    expect(result.finalPrintEnabled).toBe(true);
    expect(h.audit.record).toHaveBeenCalledWith(
      expect.objectContaining<Record<string, unknown>>({
        eventKey: 'invoice.official_values_reconciled',
        newState: expect.objectContaining<Record<string, unknown>>({
          reconciliationNote: 'Reviewed against official result',
          reconciledBy: 'user-1',
        }),
      }),
      h.tx,
    );
  });
});
