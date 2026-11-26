import { BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import { AuditService } from '../../audit/audit.service';
import { PrismaService } from '../../database/prisma.service';
import type { AuthenticatedRequest } from '../../identity/auth-user';
import { Roles } from '../../identity/roles.decorator';
import { isManualQrImage } from './manual-qr';
import { isVerifiedOfficialInvoice } from './official-invoice-eligibility';

const correction = z.object({
  reason: z.string().trim().min(1).max(500),
  qrImageDataUrl: z.string().max(60032),
  expectedRevision: z.number().int().nonnegative(),
}).strict();

@Roles('ADMIN')
@Controller('invoices/:invoiceId/qr-corrections')
export class InvoiceQrCorrectionsController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  @Get()
  history(@Param('invoiceId') invoiceId: string) {
    return this.prisma.invoiceQrCorrection.findMany({
      where: { invoiceId }, orderBy: { invoiceRevision: 'desc' }, take: 50,
    });
  }

  @Post()
  replace(@Param('invoiceId') invoiceId: string, @Body() input: unknown, @Req() req: AuthenticatedRequest) {
    const parsed = correction.safeParse(input);
    if (!parsed.success || !isManualQrImage(parsed.data.qrImageDataUrl)) {
      throw new BadRequestException('Provide a valid PNG, JPEG or WebP image and a correction reason.');
    }
    const { expectedRevision, qrImageDataUrl, reason } = parsed.data;
    return this.prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findUnique({ where: { id: invoiceId } });
      if (!invoice) throw new NotFoundException('Invoice not found.');
      // An unreadable historical image may be the reason for the correction.
      if (!isVerifiedOfficialInvoice({ ...invoice, fawtaraQrImageDataUrl: qrImageDataUrl })) {
        throw new ConflictException('Only an invoice with verified official evidence can have its QR corrected.');
      }
      if (invoice.revision !== expectedRevision || invoice.fawtaraQrImageDataUrl === qrImageDataUrl) {
        throw new ConflictException('Invoice changed or the replacement is identical. Reload before correcting.');
      }
      const updated = await tx.invoice.updateMany({
        where: { id: invoiceId, revision: expectedRevision, status: 'FAWTARA_ACCEPTED', submissionLock: null },
        data: { fawtaraQrImageDataUrl: qrImageDataUrl, revision: { increment: 1 } },
      });
      if (updated.count !== 1) throw new ConflictException('Invoice changed. Reload before correcting.');
      const record = await tx.invoiceQrCorrection.create({
        data: {
          invoiceId, invoiceRevision: expectedRevision + 1, reason, actorId: req.user.id,
          oldImageDataUrl: invoice.fawtaraQrImageDataUrl, newImageDataUrl: qrImageDataUrl,
        },
      });
      await this.audit.record({
        actorType: 'USER', actorId: req.user.id, eventKey: 'invoice.qr_corrected',
        subjectType: 'Invoice', subjectId: invoiceId,
        metadata: { correctionId: record.id, reason, revision: expectedRevision + 1 },
      }, tx);
      return { id: record.id, revision: record.invoiceRevision };
    });
  }
}
