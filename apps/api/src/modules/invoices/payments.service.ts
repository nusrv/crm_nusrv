import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { AuditService } from '../../audit/audit.service';
import { PrismaService } from '../../database/prisma.service';
import type { Payment, Prisma } from '../../generated/prisma/client';
import { ActorType } from '../../generated/prisma/enums';
import { InvoicesService } from './invoices.service';
import { officialInvoiceEvidence } from './official-invoice-eligibility';
import { effectiveReceiptAmounts, paymentSummary, paymentUnits, signedMoney, validPositiveAmount } from './payment-money';

const paymentValues = z.object({
  amount: z.string().regex(/^\d{1,11}(?:\.\d{1,3})?$/),
  paymentDate: z.iso.date(),
  method: z.enum(['BANK_TRANSFER', 'CASH', 'CHEQUE', 'CARD_GATEWAY', 'OTHER']),
  reference: z.string().trim().max(191).optional(),
  notes: z.string().trim().max(5000).optional(),
});
const paymentSchema = paymentValues.extend({
  currency: z.string().regex(/^[A-Z]{3}$/),
  idempotencyKey: z.uuid(),
}).strict();
const correctionIdentity = z.object({
  expectedVersion: z.number().int().positive(),
  reason: z.string().trim().min(1).max(500),
  idempotencyKey: z.uuid(),
});
const correctionSchema = paymentValues.extend(correctionIdentity.shape).strict();
const voidSchema = correctionIdentity.strict();
const latestReceipt = { receipt: { include: { revisions: { orderBy: { version: 'desc' }, take: 1 } } } } as const;
const orderedPayments = { orderBy: [{ paymentDate: 'asc' }, { id: 'asc' }], include: latestReceipt } as const;

function normalizedPayment(input: z.infer<typeof paymentValues>) {
  const units = paymentUnits(input.amount);
  if (units <= 0n) throw new BadRequestException('Payment amount must be positive.');
  return {
    amount: signedMoney(units), paymentDate: new Date(input.paymentDate),
    method: input.method, reference: input.reference || null, notes: input.notes || null,
  };
}

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly invoices: InvoicesService,
  ) {}

  async list(invoiceId: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId }, include: { payments: { ...orderedPayments, orderBy: [...orderedPayments.orderBy] } },
    });
    if (!invoice) throw new NotFoundException('Invoice not found.');
    const official = officialInvoiceEvidence(invoice);
    if (!official) throw new ConflictException('Collection requires an officially recorded invoice.');
    const { amounts, unresolved } = effectiveReceiptAmounts(invoice.payments, official.currency);
    return {
      invoiceNumber: official.invoiceNumber, currency: official.currency, payments: invoice.payments,
      unresolved, ...paymentSummary(official.grandTotal, amounts),
    };
  }

  async customerBalances(customerId: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } });
    if (!customer) throw new NotFoundException('Customer not found.');
    const invoices = await this.prisma.invoice.findMany({
      where: { customerId, status: 'FAWTARA_ACCEPTED' },
      include: { payments: { include: latestReceipt } },
    });
    const totals = new Map<string, { invoiced: bigint; collected: bigint; unresolved: number }>();
    for (const invoice of invoices) {
      const official = officialInvoiceEvidence(invoice);
      if (!official) continue;
      const { amounts, unresolved } = effectiveReceiptAmounts(invoice.payments, official.currency);
      const total = totals.get(official.currency) ?? { invoiced: 0n, collected: 0n, unresolved: 0 };
      total.invoiced += paymentUnits(official.grandTotal);
      total.collected += amounts.reduce((sum, value) => sum + paymentUnits(value), 0n);
      total.unresolved += unresolved;
      totals.set(official.currency, total);
    }
    return [...totals.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([currency, total]) => ({
      currency, invoiced: signedMoney(total.invoiced), collected: signedMoney(total.collected),
      outstanding: signedMoney(total.invoiced - total.collected), unresolved: total.unresolved,
    }));
  }

  async record(invoiceId: string, value: unknown, actorId: string) {
    const parsed = paymentSchema.safeParse(value);
    if (!parsed.success) throw new BadRequestException('Valid payment details and request identity are required.');
    const input = parsed.data;
    const normalized = normalizedPayment(input);
    const key = `${actorId}:${input.idempotencyKey}`;
    const document = await this.invoices.findOne(invoiceId);
    return this.write(async (tx) => {
      const official = await this.lockOfficial(tx, invoiceId);
      this.assertDocumentRevision(document, official.revision);
      if (input.currency !== official.currency) throw new BadRequestException('Payment currency must match the official invoice.');
      const existing = await tx.payment.findUnique({ where: { idempotencyKey: key } });
      if (existing) {
        if (existing.invoiceId !== invoiceId || existing.currency !== input.currency ||
            paymentUnits(existing.amount.toString()) !== paymentUnits(normalized.amount) ||
            existing.paymentDate.getTime() !== normalized.paymentDate.getTime() ||
            existing.method !== normalized.method || existing.reference !== normalized.reference ||
            existing.notes !== normalized.notes) {
          throw new ConflictException('This payment request identity was used for different details.');
        }
        return existing;
      }
      const payment = await tx.payment.create({
        data: { ...normalized, invoiceId, currency: input.currency, recordedBy: actorId, idempotencyKey: key },
      });
      await this.audit.record({
        actorType: ActorType.USER, actorId, eventKey: 'payment.recorded', subjectType: 'Payment',
        subjectId: payment.id, newState: { invoiceId, amount: normalized.amount, currency: input.currency },
      }, tx);
      await this.issue(tx, payment, document, official.invoiceNumber, actorId);
      return payment;
    });
  }

  async receipt(invoiceId: string, paymentId: string, actorId: string) {
    const document = await this.invoices.findOne(invoiceId);
    return this.write(async (tx) => {
      const official = await this.lockOfficial(tx, invoiceId);
      this.assertDocumentRevision(document, official.revision);
      const payment = await tx.payment.findFirst({ where: { id: paymentId, invoiceId } });
      if (!payment) throw new NotFoundException('Select a recorded payment for this invoice.');
      if (payment.currency !== official.currency) throw new ConflictException('Review the payment currency before issuing a receipt.');
      if (!validPositiveAmount(payment.amount.toString())) {
        throw new ConflictException('The historical payment amount needs review before a receipt can be issued.');
      }
      return this.issue(tx, payment, document, official.invoiceNumber, actorId);
    });
  }

  async correct(invoiceId: string, paymentId: string, value: unknown, actorId: string, voided: boolean) {
    const parsed = (voided ? voidSchema : correctionSchema).safeParse(value);
    if (!parsed.success) throw new BadRequestException('Valid receipt details, revision, reason and request identity are required.');
    const input = parsed.data;
    const changed = 'amount' in input ? normalizedPayment(input) : null;
    const requestKey = `${actorId}:${input.idempotencyKey}`;
    const requestHash = createHash('sha256')
      .update(JSON.stringify({ invoiceId, paymentId, voided, expected: input.expectedVersion, reason: input.reason, changed }))
      .digest('hex');
    return this.write(async (tx) => {
      const official = await this.lockOfficial(tx, invoiceId);
      const priorRequest = await tx.paymentReceiptRevision.findUnique({ where: { requestKey } });
      if (priorRequest) {
        if (priorRequest.requestHash !== requestHash) throw new ConflictException('This receipt request identity was used for different details.');
        return priorRequest;
      }
      const receipt = await tx.paymentReceipt.findFirst({
        where: { paymentId, payment: { invoiceId } },
        include: { revisions: { orderBy: { version: 'desc' }, take: 1 } },
      });
      if (!receipt) throw new NotFoundException('Receipt not found.');
      const current = receipt.revisions[0];
      if (!current || current.voided || current.version !== input.expectedVersion || current.currency !== official.currency) {
        throw new ConflictException('The receipt is void, changed, or requires legacy review. Reload its history.');
      }
      const revision = await tx.paymentReceiptRevision.create({
        data: {
          ...(changed ?? {
            amount: current.amount, paymentDate: current.paymentDate, method: current.method,
            reference: current.reference, notes: current.notes,
          }),
          receiptId: receipt.id, version: current.version + 1, currency: current.currency, voided,
          reason: input.reason, actorId, requestKey, requestHash,
        },
      });
      await this.audit.record({
        actorType: ActorType.USER, actorId, eventKey: voided ? 'payment.receipt_voided' : 'payment.receipt_corrected',
        subjectType: 'PaymentReceipt', subjectId: receipt.id,
        oldState: { version: current.version, amount: current.amount.toString(), voided: current.voided },
        newState: { version: revision.version, amount: revision.amount.toString(), voided, reason: input.reason },
      }, tx);
      return revision;
    });
  }

  async getReceipt(invoiceId: string, paymentId: string) {
    const receipt = await this.prisma.paymentReceipt.findFirst({
      where: { paymentId, payment: { invoiceId } },
      include: { revisions: { orderBy: { version: 'desc' } } },
    });
    if (!receipt) throw new NotFoundException('Receipt not found.');
    const snapshot = receipt.snapshot as unknown as {
      invoiceNumber?: string;
      invoice?: { issuerLogoAssetId?: string; billingEntityId: string };
    };
    const asset = snapshot.invoice?.issuerLogoAssetId ? await this.prisma.invoiceBrandingAsset.findFirst({
      where: { id: snapshot.invoice.issuerLogoAssetId, billingEntityId: snapshot.invoice.billingEntityId },
    }) : null;
    return {
      ...receipt, effective: receipt.revisions[0] ?? null,
      issuerLogoDataUrl: asset ? `data:${asset.mimeType};base64,${Buffer.from(asset.bytes).toString('base64')}` : null,
    };
  }

  private async lockOfficial(tx: Prisma.TransactionClient, invoiceId: string) {
    await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${invoiceId} FOR UPDATE`;
    const invoice = await tx.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw new NotFoundException('Invoice not found.');
    const official = officialInvoiceEvidence(invoice);
    if (!official) throw new ConflictException('Collection requires an officially recorded invoice.');
    return { ...official, revision: invoice.revision };
  }

  /**
   * The immutable receipt snapshot is constructed from findOne() before entering
   * the collection transaction. Refuse to freeze a stale invoice/branding/QR
   * version if another operator corrected the invoice before we acquired its
   * FOR UPDATE lock; the caller can reload and retry instead.
   */
  private assertDocumentRevision(document: Awaited<ReturnType<InvoicesService['findOne']>>, revision: number) {
    if (document.revision !== revision) {
      throw new ConflictException('Invoice changed while preparing the receipt. Reload and retry.');
    }
  }

  private async issue(
    tx: Prisma.TransactionClient,
    payment: Payment,
    invoice: Awaited<ReturnType<InvoicesService['findOne']>>,
    invoiceNumber: string,
    actorId: string,
  ) {
    const existing = await tx.paymentReceipt.findUnique({ where: { paymentId: payment.id } });
    if (existing) return existing;
    const { issuerLogoDataUrl: _logo, ...document } = invoice;
    const snapshot = JSON.parse(JSON.stringify({ invoiceNumber, invoice: document, payment })) as Prisma.InputJsonValue;
    const receipt = await tx.paymentReceipt.create({
      data: {
        paymentId: payment.id, snapshot, createdBy: actorId,
        revisions: {
          create: {
            version: 1, amount: payment.amount, currency: payment.currency,
            paymentDate: payment.paymentDate, method: payment.method, reference: payment.reference,
            notes: payment.notes, reason: 'Initial receipt', actorId,
          },
        },
      },
    });
    await this.audit.record({
      actorType: ActorType.USER, actorId, eventKey: 'payment.receipt_created', subjectType: 'PaymentReceipt',
      subjectId: receipt.id, metadata: { invoiceId: payment.invoiceId, paymentId: payment.id, invoiceNumber },
    }, tx);
    return receipt;
  }

  private async write<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(operation);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
        throw new ConflictException('The receipt or request identity already exists. Reload and check the result.');
      }
      throw error;
    }
  }
}
