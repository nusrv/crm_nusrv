import { randomUUID } from 'node:crypto';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../src/generated/prisma/client';
import { InvoiceStatus, PaymentScope } from '../src/generated/prisma/enums';
import { toMariaDbDriverUrl } from '../src/database/mariadb-url';
import { effectiveReceiptAmounts, paymentSummary } from '../src/modules/invoices/payment-money';
import { isVerifiedOfficialInvoice } from '../src/modules/invoices/official-invoice-eligibility';

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
  let prisma: PrismaClient;
  let issuerId: string;
  let invoiceId: string;

  beforeAll(async () => {
    const isolated = requireDisposableUrl(url!);
    prisma = new PrismaClient({ adapter: new PrismaMariaDb(toMariaDbDriverUrl(isolated)) });
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
});
