import { jest } from '@jest/globals';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { InvoiceQrCorrectionsController } from './invoice-qr-corrections.controller';

const VALID_QR_IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';
const USER = { user: { id: 'admin-1' } };
const REQUEST = {
  expectedRevision: 2,
  reason: 'Historical QR image was unreadable and was replaced from issuer evidence',
  qrImageDataUrl: VALID_QR_IMAGE,
};

function invoice(changes: Record<string, unknown> = {}) {
  return {
    id: 'invoice-1',
    revision: 2,
    status: 'FAWTARA_ACCEPTED',
    submissionLock: null,
    officializationProvenance: 'MANUAL',
    fawtaraStatus: 'SUBMITTED',
    fawtaraInvoiceNumber: 'NS-2026-500',
    fawtaraAcceptedAt: new Date('2026-11-22'),
    fawtaraQrImageDataUrl: 'legacy-unreadable-original-qr',
    officialCurrencyCode: 'JOD',
    officialGrandTotal: { toString: () => '100.000' },
    billingEntityId: 'issuer-1',
    issuerLegalNameSnapshot: 'NUSRV',
    ...changes,
  };
}

function harness(source = invoice(), changed = 1) {
  const updateMany = jest.fn((input: unknown) => { void input; return Promise.resolve({ count: changed }); });
  const create = jest.fn(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: 'correction-1', ...data }));
  const tx = {
    invoice: { findUnique: jest.fn((input: unknown) => { void input; return Promise.resolve(source); }), updateMany },
    invoiceQrCorrection: { create },
  };
  const auditRecord = jest.fn((event: unknown, tx: unknown) => { void event; void tx; return Promise.resolve({ id: 'audit-1' }); });
  const prisma = {
    $transaction: async <T>(fn: (value: typeof tx) => Promise<T>): Promise<T> => fn(tx),
  };
  const controller = new InvoiceQrCorrectionsController(
    prisma as never, { record: auditRecord } as never,
  );
  return { controller, updateMany, create, auditRecord };
}

describe('P1 historical invoice QR correction (OD-8)', () => {
  it('retains the original image and records replacement, actor, reason and revision', async () => {
    const h = harness();
    const result = await h.controller.replace('invoice-1', REQUEST, USER as never);
    expect(result).toEqual({ id: 'correction-1', revision: 3 });
    expect(h.updateMany).toHaveBeenCalledTimes(1);
    const data = h.create.mock.calls[0]![0].data;
    expect(data.oldImageDataUrl).toBe('legacy-unreadable-original-qr');
    expect(data.newImageDataUrl).toBe(VALID_QR_IMAGE);
    expect(data.invoiceRevision).toBe(3);
    expect(data.reason).toBe(REQUEST.reason);
    expect(data.actorId).toBe('admin-1');
    expect(h.auditRecord).toHaveBeenCalledTimes(1);
  });

  it('refuses a correction when the invoice revision changed concurrently', async () => {
    const h = harness(invoice(), 0);
    await expect(h.controller.replace('invoice-1', REQUEST, USER as never))
      .rejects.toThrow(ConflictException);
    expect(h.create).not.toHaveBeenCalled();
  });

  it('rejects a missing reason, malformed replacement and repeated identical image', async () => {
    const h = harness();
    expect(() => h.controller.replace('invoice-1', {
      ...REQUEST, reason: '',
    }, USER as never)).toThrow(BadRequestException);
    expect(() => h.controller.replace('invoice-1', {
      ...REQUEST, qrImageDataUrl: 'data:image/png;base64,AAAA',
    }, USER as never)).toThrow(BadRequestException);
    const identical = harness(invoice({ fawtaraQrImageDataUrl: VALID_QR_IMAGE }));
    await expect(identical.controller.replace('invoice-1', REQUEST, USER as never))
      .rejects.toThrow(ConflictException);
  });

  it('rejects correction of a draft or non-official invoice even when the new image is valid', async () => {
    const h = harness(invoice({ status: 'DRAFT' }));
    await expect(h.controller.replace('invoice-1', REQUEST, USER as never))
      .rejects.toThrow(ConflictException);
    expect(h.updateMany).not.toHaveBeenCalled();
    expect(h.create).not.toHaveBeenCalled();
  });
});
