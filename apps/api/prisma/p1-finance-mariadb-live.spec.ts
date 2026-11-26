import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../src/audit/audit.service';
import { PrismaService } from '../src/database/prisma.service';
import { InvoiceStatus, PaymentScope } from '../src/generated/prisma/enums';
import { effectiveReceiptAmounts, paymentSummary } from '../src/modules/invoices/payment-money';
import { isVerifiedOfficialInvoice } from '../src/modules/invoices/official-invoice-eligibility';
import { RenewalCasesService } from '../src/modules/renewal-cases/renewal-cases.service';
import { BusinessTimeService } from '../src/time/business-time.service';

const url = process.env.MARIADB_TEST_DATABASE_URL;
const liveDescribe = url ? describe : describe.skip;
const qr = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';
const invoiceDate = new Date('2026-11-23T00:00:00.000Z');
const actor = 'p1-ci-admin';
const currency = 'JOD';

function requireDisposableUrl(input: string): string {
  const parsed = new URL(input);
  const name = decodeURIComponent(parsed.pathname.slice(1));
  if (parsed.protocol !== 'mysql:' || parsed.hostname !== '127.0.0.1' ||
      parsed.port !== '3306' || name !== 'nusrv_rehearsal_test') {
    throw new Error('P1 MariaDB tests run only against the local disposable nusrv_rehearsal_test database.');
  }
  return input;
}

liveDescribe('P1 actual MariaDB receipt constraints and effective balances (disposable CI)', () => {
  let prisma: PrismaService;
  let issuerId: string;
  let invoiceId: string;
  let renewalFixture: { serviceTypeId: string; customerId: string; subscriptionId: string; renewalId: string } | undefined;

  beforeAll(async () => {
    const isolated = requireDisposableUrl(url!);
    prisma = new PrismaService(new ConfigService({ DATABASE_URL: isolated }));
    const issuer = await prisma.billingEntity.create({
      data: {
        code: `P1-CI-${randomUUID()}`,
        customerCodePrefix: `P${randomUUID().slice(0, 6).toUpperCase()}`,
        name: 'P1 Disposable Issuer',
        legalName: 'P1 Disposable Issuer LLC',
        paymentScope: PaymentScope.LOCAL,
      },
    });
    issuerId = issuer.id;
  });

  beforeEach(async () => {
    const row = await prisma.invoice.create({
      data: {
        billingEntityId: issuerId,
        status: InvoiceStatus.FAWTARA_ACCEPTED,
        internalReference: `P1CI-${randomUUID()}`,
        invoiceDate,
        currencyCode: currency,
        periodStart: invoiceDate,
        periodEnd: new Date('2027-11-22T00:00:00.000Z'),
        customerCodeSnapshot: 'ONE-TIME',
        customerNameEnSnapshot: 'CI One-time Buyer',
        customerAddressSnapshot: 'CI Buyer Address',
        customerCountrySnapshot: 'Jordan',
        issuerCodeSnapshot: 'P1-CI',
        issuerLegalNameSnapshot: 'P1 Disposable Issuer LLC',
        subtotal: '100.000',
        grandTotal: '100.000',
        fawtaraStatus: 'SUBMITTED',
        fawtaraInvoiceNumber: `P1-CI-${randomUUID()}`,
        fawtaraAcceptedAt: invoiceDate,
        fawtaraQrImageDataUrl: qr,
        officialCurrencyCode: currency,
        officialSubtotal: '100.000',
        officialDiscountTotal: '0.000',
        officialTaxTotal: '0.000',
        officialGrandTotal: '100.000',
        officializationProvenance: 'MANUAL',
      },
    });
    invoiceId = row.id;
    expect(isVerifiedOfficialInvoice(row)).toBe(true);
  });

  afterEach(async () => {
    const payments = await prisma.payment.findMany({
      where: { invoiceId },
      include: { receipt: true },
    });
    const receiptIds = payments.flatMap((payment) => payment.receipt ? [payment.receipt.id] : []);
    await prisma.paymentReceiptRevision.deleteMany({ where: { receiptId: { in: receiptIds } } });
    await prisma.paymentReceipt.deleteMany({ where: { id: { in: receiptIds } } });
    await prisma.payment.deleteMany({ where: { invoiceId } });
    await prisma.invoice.delete({ where: { id: invoiceId } });
    if (renewalFixture) {
      const { serviceTypeId, customerId, subscriptionId, renewalId } = renewalFixture;
      await prisma.$transaction([
        prisma.renewalCase.deleteMany({ where: { id: renewalId } }),
        prisma.subscription.deleteMany({ where: { id: subscriptionId } }),
        prisma.customer.deleteMany({ where: { id: customerId } }),
        prisma.serviceType.deleteMany({ where: { id: serviceTypeId } }),
      ]);
      renewalFixture = undefined;
    }
  });

  afterAll(async () => {
    if (prisma) {
      if (issuerId) await prisma.billingEntity.delete({ where: { id: issuerId } });
      await prisma.$disconnect();
    }
  });

  function paymentInput(amount: string, key: string = randomUUID()) {
    return {
      invoiceId, amount, currency, paymentDate: invoiceDate,
      method: 'BANK_TRANSFER', recordedBy: actor, idempotencyKey: key,
    };
  }

  async function recordWithReceipt(amount: string) {
    return prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({ data: paymentInput(amount) });
      const receipt = await tx.paymentReceipt.create({
        data: { paymentId: payment.id, createdBy: actor, snapshot: { invoiceNumber: 'CI-VERIFIED' } },
      });
      await tx.paymentReceiptRevision.create({
        data: {
          receiptId: receipt.id, version: 1, amount, currency,
          paymentDate: invoiceDate, method: 'BANK_TRANSFER',
          reason: 'Initial recorded payment', actorId: actor,
        },
      });
      return { payment, receipt };
    });
  }

  async function balance() {
    const payments = await prisma.payment.findMany({
      where: { invoiceId },
      include: {
        receipt: { include: { revisions: { orderBy: { version: 'desc' } } } },
      },
    });
    const effective = effectiveReceiptAmounts(payments, currency);
    return { ...paymentSummary('100.000', effective.amounts), unresolved: effective.unresolved };
  }

  it('persists partial receipts, correction and void as immutable versions with exact JOD balances', async () => {
    const first = await recordWithReceipt('40.000');
    const second = await recordWithReceipt('30.000');
    expect(await balance()).toEqual({
      total: '100.000', paid: '70.000', balance: '30.000',
      status: 'PARTIALLY_PAID', unresolved: 0,
    });
    await prisma.paymentReceiptRevision.create({
      data: {
        receiptId: first.receipt.id, version: 2, amount: '35.000', currency,
        paymentDate: invoiceDate, method: 'BANK_TRANSFER',
        reason: 'Correct amount', actorId: actor,
      },
    });
    expect(await balance()).toMatchObject({ paid: '65.000', balance: '35.000', unresolved: 0 });
    await prisma.paymentReceiptRevision.create({
      data: {
        receiptId: second.receipt.id, version: 2, amount: '30.000', currency,
        paymentDate: invoiceDate, method: 'BANK_TRANSFER',
        voided: true, reason: 'Erroneous receipt', actorId: actor,
      },
    });
    expect(await balance()).toMatchObject({ paid: '35.000', balance: '65.000', unresolved: 0 });
    expect(await prisma.paymentReceiptRevision.count({ where: { receiptId: first.receipt.id } })).toBe(2);
    expect(await prisma.paymentReceiptRevision.count({ where: { receiptId: second.receipt.id } })).toBe(2);
    await expect(prisma.paymentReceiptRevision.create({
      data: {
        receiptId: first.receipt.id, version: 2, amount: '35.000', currency,
        paymentDate: invoiceDate, method: 'BANK_TRANSFER',
        reason: 'Accidental repeated version', actorId: actor,
      },
    })).rejects.toThrow();
    expect(await prisma.payment.count({ where: { invoiceId } })).toBe(2);
  });

  it('rolls back an incomplete payment transaction and lets exactly one concurrent duplicate key win', async () => {
    const rolledBackKey = `P1:${randomUUID()}`;
    await expect(prisma.$transaction(async (tx) => {
      await tx.payment.create({ data: paymentInput('10.000', rolledBackKey) });
      throw new Error('simulated receipt creation failure');
    })).rejects.toThrow('simulated receipt creation failure');
    expect(await prisma.payment.findUnique({ where: { idempotencyKey: rolledBackKey } })).toBeNull();

    const key = `P1:${randomUUID()}`;
    const results = await Promise.allSettled([
      prisma.payment.create({ data: paymentInput('40.000', key) }),
      prisma.payment.create({ data: paymentInput('40.000', key) }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(await prisma.payment.count({ where: { invoiceId } })).toBe(1);
    const entry = await prisma.payment.findUniqueOrThrow({ where: { idempotencyKey: key } });
    expect(entry.amount.toFixed(3)).toBe('40.000');
  });

  it('fulfills an official unpaid renewal once under two competing requests', async () => {
    const ids = { serviceTypeId: randomUUID(), customerId: randomUUID(), subscriptionId: randomUUID(), renewalId: randomUUID() };
    renewalFixture = ids;
    const periodEnd = new Date('2027-11-22T00:00:00.000Z');
    const nextRenewal = new Date('2027-11-23T00:00:00.000Z');
    const settledAt = new Date('2026-11-24T09:00:00.000Z');
    await prisma.serviceType.create({
      data: { id: ids.serviceTypeId, code: `CI-${randomUUID().slice(0, 8)}`, name: 'Disposable renewal service' },
    });
    await prisma.customer.create({
      data: {
        id: ids.customerId, billingEntityId: issuerId, customerCode: `CI-${ids.customerId}`,
        nameEn: 'Disposable renewal customer', primaryEmail: 'renewal@example.test',
      },
    });
    await prisma.subscription.create({
      data: {
        id: ids.subscriptionId, customerId: ids.customerId, serviceTypeId: ids.serviceTypeId,
        subscriptionCode: `CI-${ids.subscriptionId}`, name: 'Disposable subscription',
        startDate: new Date('2025-11-23T00:00:00.000Z'), renewalDate: invoiceDate,
        billingFrequency: 'ANNUAL', sellingPrice: '100.000', currency,
      },
    });
    await prisma.renewalCase.create({
      data: {
        id: ids.renewalId, subscriptionId: ids.subscriptionId, cycleStartDate: invoiceDate, dueDate: invoiceDate,
        status: 'ACCEPTED', customerDecision: 'ACCEPTED', acceptedAt: invoiceDate,
        proposedPeriodStart: invoiceDate, proposedPeriodEnd: periodEnd, proposedNextRenewalDate: nextRenewal,
        clarificationPending: true, communicationRevision: 3,
      },
    });
    await prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        customerId: ids.customerId, sourceSubscriptionId: ids.subscriptionId,
        sourceRenewalCaseId: ids.renewalId, renewalOfficialKey: ids.renewalId,
      },
    });
    const service = new RenewalCasesService(prisma, new AuditService(prisma), { now: () => settledAt },
      new BusinessTimeService(new ConfigService({ BUSINESS_TIMEZONE: 'Asia/Amman' })));
    const actors = ['p1-disposable-admin-a', 'p1-disposable-admin-b'];
    const outcomes = await Promise.allSettled(actors.map((actorId) => service.markFulfilled(ids.renewalId, { actorId })));
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.find((result) => result.status === 'rejected')?.reason).toBeInstanceOf(ConflictException);
    expect(await prisma.renewalCase.findUniqueOrThrow({ where: { id: ids.renewalId } })).toMatchObject({
      status: 'FULFILLED', fulfilledAt: settledAt, clarificationPending: false, communicationRevision: 4,
    });
    expect(await prisma.subscription.findUniqueOrThrow({ where: { id: ids.subscriptionId } })).toMatchObject({
      renewalDate: nextRenewal, currentTermEndDate: periodEnd,
    });
    expect(await prisma.payment.count({ where: { invoiceId } })).toBe(0);
    const events = await prisma.auditEvent.findMany({ where: {
      subjectType: 'RenewalCase', subjectId: ids.renewalId, eventKey: 'renewal.case.marked_fulfilled',
    } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actorId: actors[outcomes.findIndex((result) => result.status === 'fulfilled')],
      metadata: { invoiceId, trackingOnly: true },
    });
  });
});
