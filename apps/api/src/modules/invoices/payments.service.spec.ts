import { jest } from '@jest/globals';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { PaymentsService } from './payments.service';

const QR = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';
const PAY_KEY = '0e5e4a00-4182-421d-8f07-42cf8fbe50dd';
const EDIT_KEY = '0e5e4a00-4182-421d-8f07-42cf8fbe50de';
const AMOUNT = (value: string) => ({ toString: () => value, toJSON: () => value });

const originalPayment = {
  id: 'payment-1', invoiceId: 'invoice-1', amount: AMOUNT('40.000'),
  currency: 'JOD', paymentDate: new Date('2026-11-20'), method: 'BANK_TRANSFER',
  reference: null, notes: null, recordedBy: 'admin-1',
  idempotencyKey: 'admin-1:' + PAY_KEY,
};

const originalRevision = {
  version: 1, amount: AMOUNT('40.000'), currency: 'JOD',
  paymentDate: new Date('2026-11-20'), method: 'BANK_TRANSFER',
  reference: null, notes: null, voided: false,
};

function officialInvoice(status = 'FAWTARA_ACCEPTED') {
  return {
    id: 'invoice-1', status, billingEntityId: 'issuer-1',
    submissionLock: null, officializationProvenance: 'MANUAL',
    fawtaraStatus: 'SUBMITTED', fawtaraInvoiceNumber: 'NS-2026-500',
    fawtaraAcceptedAt: new Date('2026-11-22'), fawtaraQrImageDataUrl: QR,
    officialCurrencyCode: 'JOD', officialGrandTotal: AMOUNT('100.000'),
    issuerLegalNameSnapshot: 'NUSRV', revision: 2,
  };
}

function harness(status = 'FAWTARA_ACCEPTED') {
  let persisted: typeof originalPayment | null = null;
  const invoice = officialInvoice(status);
  const paymentCreate = jest.fn(async (_input: unknown) => {
    persisted = originalPayment;
    return originalPayment;
  });
  const receiptCreate = jest.fn(async (input: { data: Record<string, unknown> }) => ({
    id: 'receipt-1', ...input.data,
  }));
  const revisionCreate = jest.fn(async (input: { data: Record<string, unknown> }) => ({
    id: 'revision-2', ...input.data,
  }));
  const auditRecord = jest.fn(async (_event: unknown, _tx?: unknown) => ({ id: 'audit-1' }));
  const tx = {
    $queryRaw: jest.fn(async () => [{ id: 'invoice-1' }]),
    invoice: { findUnique: jest.fn(async () => invoice) },
    payment: {
      findUnique: jest.fn(async () => persisted),
      findFirst: jest.fn(async () => persisted),
      create: paymentCreate,
    },
    paymentReceipt: {
      findUnique: jest.fn(async () => null),
      findFirst: jest.fn(async () => ({
        id: 'receipt-1', paymentId: originalPayment.id,
        revisions: [originalRevision],
      })),
      create: receiptCreate,
    },
    paymentReceiptRevision: {
      findUnique: jest.fn(async () => null),
      create: revisionCreate,
    },
  };
  const prisma = {
    $transaction: async <T>(callback: (client: typeof tx) => Promise<T>): Promise<T> => callback(tx),
  };
  const invoices = {
    findOne: jest.fn(async () => ({
      id: invoice.id,
      revision: 2,
      issuerLogoDataUrl: null,
      billingEntityId: 'issuer-1',
      issuerLegalNameSnapshot: 'NUSRV',
      officialCurrencyCode: 'JOD',
    })),
  };
  const service = new PaymentsService(prisma as never, { record: auditRecord } as never, invoices as never);
  return { service, tx, paymentCreate, receiptCreate, revisionCreate, auditRecord, invoices };
}

function paymentRequest(override: Record<string, unknown> = {}) {
  return {
    amount: '40.000', currency: 'JOD', paymentDate: '2026-11-20',
    method: 'BANK_TRANSFER', idempotencyKey: PAY_KEY, ...override,
  };
}

describe('P1 PaymentsService — official-only collection and receipt integrity', () => {
  it('refuses to record a payment or receipt before officialization', async () => {
    const h = harness('DRAFT');
    await expect(h.service.record('invoice-1', paymentRequest(), 'admin-1')).rejects.toThrow(ConflictException);
    expect(h.paymentCreate).not.toHaveBeenCalled();
    expect(h.receiptCreate).not.toHaveBeenCalled();
  });

  it('rejects a receipt snapshot prepared from an older invoice revision', async () => {
    const h = harness();
    h.tx.invoice.findUnique.mockResolvedValueOnce({ ...officialInvoice(), revision: 3 });
    await expect(h.service.record('invoice-1', paymentRequest(), 'admin-1'))
      .rejects.toThrow(ConflictException);
    expect(h.paymentCreate).not.toHaveBeenCalled();
    expect(h.receiptCreate).not.toHaveBeenCalled();
  });

  it('rejects wrong invoice currency before writing a payment', async () => {
    const h = harness();
    await expect(h.service.record('invoice-1', paymentRequest({ currency: 'USD' }), 'admin-1'))
      .rejects.toThrow(BadRequestException);
    expect(h.paymentCreate).not.toHaveBeenCalled();
  });

  it('creates a recorded payment and first receipt together with the official number', async () => {
    const h = harness();
    const result = await h.service.record('invoice-1', paymentRequest(), 'admin-1');
    expect(result.id).toBe('payment-1');
    expect(h.paymentCreate).toHaveBeenCalledTimes(1);
    expect(h.receiptCreate).toHaveBeenCalledTimes(1);
    const input = h.receiptCreate.mock.calls[0]![0]!;
    const snapshot = input.data.snapshot as { invoiceNumber: string; payment: { id: string } };
    expect(snapshot.invoiceNumber).toBe('NS-2026-500');
    expect(snapshot.payment.id).toBe('payment-1');
    expect(h.auditRecord).toHaveBeenCalledTimes(2);
  });

  it('replays the same request identity without adding a second Payment or receipt', async () => {
    const h = harness();
    await h.service.record('invoice-1', paymentRequest(), 'admin-1');
    const replay = await h.service.record('invoice-1', paymentRequest(), 'admin-1');
    expect(replay.id).toBe('payment-1');
    expect(h.paymentCreate).toHaveBeenCalledTimes(1);
    expect(h.receiptCreate).toHaveBeenCalledTimes(1);
  });

  it('rejects reuse of the same payment key for different values', async () => {
    const h = harness();
    await h.service.record('invoice-1', paymentRequest(), 'admin-1');
    await expect(h.service.record('invoice-1', paymentRequest({ amount: '41.000' }), 'admin-1'))
      .rejects.toThrow(ConflictException);
    expect(h.paymentCreate).toHaveBeenCalledTimes(1);
  });

  it('can issue a first receipt for a verified historical payment without recording a second payment', async () => {
    const h = harness();
    h.tx.payment.findFirst.mockResolvedValueOnce(originalPayment);
    const receipt = await h.service.receipt('invoice-1', 'payment-1', 'admin-1');
    expect(receipt.id).toBe('receipt-1');
    expect(h.paymentCreate).not.toHaveBeenCalled();
    expect(h.receiptCreate).toHaveBeenCalledTimes(1);
  });

  it.each(['-1.000', '0.000'])(
    'refuses to issue a receipt for a historical payment of %s',
    async (amount) => {
      const h = harness();
      h.tx.payment.findFirst.mockResolvedValueOnce({
        ...originalPayment, amount: AMOUNT(amount),
      });
      await expect(h.service.receipt('invoice-1', 'payment-1', 'admin-1'))
        .rejects.toThrow(ConflictException);
      expect(h.receiptCreate).not.toHaveBeenCalled();
      expect(h.paymentCreate).not.toHaveBeenCalled();
    },
  );

  it('records receipt correction as an additive version without rewriting the original payment', async () => {
    const h = harness();
    const newVersion = await h.service.correct('invoice-1', 'payment-1', {
      amount: '35.000', paymentDate: '2026-11-20', method: 'BANK_TRANSFER',
      reason: 'Correct entered amount', expectedVersion: 1, idempotencyKey: EDIT_KEY,
    }, 'admin-1', false);
    expect(newVersion.version).toBe(2);
    expect(newVersion.amount).toBe('35.000');
    expect(newVersion.voided).toBe(false);
    expect(h.revisionCreate).toHaveBeenCalledTimes(1);
    expect(h.paymentCreate).not.toHaveBeenCalled();
  });

  it('rejects stale correction revisions and does not create an audit revision', async () => {
    const h = harness();
    await expect(h.service.correct('invoice-1', 'payment-1', {
      amount: '35.000', paymentDate: '2026-11-20', method: 'BANK_TRANSFER',
      reason: 'Stale request', expectedVersion: 2, idempotencyKey: EDIT_KEY,
    }, 'admin-1', false)).rejects.toThrow(ConflictException);
    expect(h.revisionCreate).not.toHaveBeenCalled();
  });

  it('voids the effective receipt with an audit revision while retaining the original payment', async () => {
    const h = harness();
    const version = await h.service.correct('invoice-1', 'payment-1', {
      reason: 'Entered against wrong receipt', expectedVersion: 1, idempotencyKey: EDIT_KEY,
    }, 'admin-1', true);
    expect(version.version).toBe(2);
    expect(version.voided).toBe(true);
    expect(h.revisionCreate).toHaveBeenCalledTimes(1);
    expect(h.paymentCreate).not.toHaveBeenCalled();
  });
});
