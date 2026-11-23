import { parseOfficialValues } from './official-values';
import { moneyEqual } from './invoice-money';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import { SecretEncryptionService } from '../../security/secret-encryption.service';
import { AuditService } from '../../audit/audit.service';
import { ActorType, InvoiceStatus } from '../../generated/prisma/enums';
import type { Prisma } from '../../generated/prisma/client';
import { InvoicesService } from './invoices.service';
import { FawtaraMapper } from './fawtara-mapper';
import { JoFotaraError, JoFotaraGateway } from './jofotara.gateway';
import { officialQrImage } from './official-qr';
import type { SubmitOfficialInvoiceDto } from './invoices.dto';
export interface HumanSubmissionContext {
  actorId: string;
  roles: readonly string[];
  initiation: 'HUMAN';
  ipAddress?: string;
}
@Injectable()
export class FawtaraSubmissionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: SecretEncryptionService,
    private readonly audit: AuditService,
    private readonly invoices: InvoicesService,
    private readonly mapper: FawtaraMapper,
    private readonly gateway: JoFotaraGateway,
  ) {}
  async history(invoiceId: string) {
    return this.prisma.fawtaraSubmission.findMany({
      where: { invoiceId },
      orderBy: { attemptNumber: 'asc' },
      select: {
        id: true,
        invoiceId: true,
        joFotaraConnectionId: true,
        attemptNumber: true,
        businessId: true,
        businessUuid: true,
        requestXmlHash: true,
        connectionNameSnapshot: true,
        incomeSourceSnapshot: true,
        httpStatus: true,
        einvStatus: true,
        results: true,
        message: true,
        officialNumber: true,
        officialUuid: true,
        outcome: true,
        errorClassification: true,
        actorId: true,
        createdAt: true,
        submittedAt: true,
        completedAt: true,
      },
    });
  }
  async submit(id: string, input: SubmitOfficialInvoiceDto, context: HumanSubmissionContext) {
    if (context.initiation !== 'HUMAN' || !context.roles.includes('ADMIN'))
      throw new ForbiddenException('Only an authorized human may submit.');
    if (input.confirmation !== 'CREATE_REAL_JOFOTARA_INVOICE')
      throw new BadRequestException('Explicit real-invoice confirmation required.');
    const preflight = await this.invoices.preflight(id);
    if (!preflight.valid)
      throw new BadRequestException({ message: 'Current preflight failed.', preflight });
    const reserved = await this.prisma.$transaction(async (tx) => {
      const i = await tx.invoice.findUnique({
        where: { id },
        include: { lines: { orderBy: { position: 'asc' } } },
      });
      if (!i) throw new NotFoundException('Invoice not found.');
      // Same issuer lock as connection configuration prevents a config race at reservation.
      await tx.$queryRaw`SELECT id FROM billing_entities WHERE id = ${i.billingEntityId} FOR UPDATE`;
      if (i.status !== InvoiceStatus.READY_FOR_FAWTARA)
        throw new BadRequestException('Invoice must be READY_FOR_FAWTARA.');
      const latest = await tx.fawtaraSubmission.findFirst({
        where: { invoiceId: id },
        orderBy: { attemptNumber: 'desc' },
      });
      const stalePending =
        latest?.outcome === 'PENDING' && latest.createdAt.getTime() < Date.now() - 300000;
      const recovering = Boolean(
        input.recoverUncertain && (latest?.outcome === 'UNKNOWN' || stalePending),
      );
      if (i.submissionLock && !recovering)
        throw new ConflictException(
          'Submission is pending or outcome unknown. Review history before explicit recovery.',
        );
      if (input.recoverUncertain && !recovering)
        throw new BadRequestException('No uncertain attempt is available to recover.');
      const selected = recovering
        ? latest!.joFotaraConnectionId
        : (input.connectionId ?? i.selectedConnectionId);
      const c = await tx.joFotaraConnection.findFirst({
        where: {
          billingEntityId: i.billingEntityId,
          ...(selected ? { id: selected } : { defaultEntityKey: i.billingEntityId }),
        },
      });
      if (
        !c ||
        !c.enabled ||
        !c.productionSubmissionEnabled ||
        !c.clientIdCiphertext ||
        !c.secretKeyCiphertext
      )
        throw new BadRequestException(
          'Enabled issuer-scoped connection, encrypted credentials, and production permission required.',
        );
      const mapping = recovering
        ? {
            xml: latest!.requestXml,
            hash: latest!.requestXmlHash,
            encodedUblInvoice: Buffer.from(latest!.requestXml, 'utf8').toString('base64'),
          }
        : this.mapper.map(i, c.incomeSourceSequence);
      let credentials: { clientId: string; secretKey: string };
      try {
        credentials = {
          clientId: this.secrets.decrypt<string>(c.clientIdCiphertext),
          secretKey: this.secrets.decrypt<string>(c.secretKeyCiphertext),
        };
      } catch {
        throw new BadRequestException(
          'Connection credentials cannot be decrypted. Check deployment encryption configuration.',
        );
      }
      const lock = randomUUID();
      const changed = await tx.invoice.updateMany({
        where: {
          id,
          status: InvoiceStatus.READY_FOR_FAWTARA,
          submissionLock: i.submissionLock,
          revision: i.revision,
        },
        data: { submissionLock: lock, revision: { increment: 1 } },
      });
      if (changed.count !== 1) throw new ConflictException('Invoice changed concurrently.');
      const attempt = await tx.fawtaraSubmission.create({
        data: {
          invoiceId: id,
          joFotaraConnectionId: c.id,
          attemptNumber: (latest?.attemptNumber ?? 0) + 1,
          businessId: i.internalReference,
          businessUuid: i.submissionUuid,
          requestXmlHash: mapping.hash,
          requestXml: mapping.xml,
          connectionNameSnapshot: c.displayName,
          incomeSourceSnapshot: recovering ? latest!.incomeSourceSnapshot : c.incomeSourceSequence,
          outcome: 'PENDING',
          actorId: context.actorId,
          submittedAt: new Date(),
        },
      });
      await tx.joFotaraConnection.update({ where: { id: c.id }, data: { lastUsedAt: new Date() } });
      await this.audit.record(
        {
          actorType: ActorType.USER,
          actorId: context.actorId,
          eventKey: 'invoice.real_submission_initiated',
          subjectType: 'Invoice',
          subjectId: id,
          metadata: {
            submissionId: attempt.id,
            connectionId: c.id,
            requestXmlHash: mapping.hash,
            recovering,
          },
          ipAddress: context.ipAddress,
        },
        tx,
      );
      return { i, c, attempt, mapping, credentials, lock };
    });
    let result: Awaited<ReturnType<JoFotaraGateway['submit']>>;
    let qrImage: string | null = null;
    let officialValues: ReturnType<typeof parseOfficialValues> = null;
    try {
      result = await this.gateway.submit(reserved.mapping.encodedUblInvoice, reserved.credentials);
      if (result.status !== 'NOT_SUBMITTED') {
        if (
          result.number !== reserved.i.internalReference ||
          result.uuid !== reserved.i.submissionUuid
        )
          throw new JoFotaraError('IDENTITY_MISMATCH', result.httpStatus);
        officialValues = parseOfficialValues(
          result.signedInvoice,
          reserved.i.internalReference,
          reserved.i.submissionUuid,
        );
        qrImage = await officialQrImage(result.qr!);
      }
    } catch (error) {
      const classification =
        error instanceof JoFotaraError ? error.classification : 'PROCESSING_FAILED';
      await this.prisma.$transaction(async (tx) => {
        await tx.fawtaraSubmission.update({
          where: { id: reserved.attempt.id },
          data: {
            outcome: 'UNKNOWN',
            errorClassification: classification,
            httpStatus: error instanceof JoFotaraError ? error.httpStatus : undefined,
            completedAt: new Date(),
          },
        });
        await this.audit.record(
          {
            actorType: ActorType.USER,
            actorId: context.actorId,
            eventKey: 'invoice.submission_outcome_unknown',
            subjectType: 'Invoice',
            subjectId: id,
            metadata: { submissionId: reserved.attempt.id, classification },
          },
          tx,
        );
      });
      // Lock intentionally retained. No correction, manual acceptance, or replacement while uncertain.
      throw new BadRequestException(
        'Submission outcome unknown. Review history; explicit recovery reuses the exact same XML, ID, UUID and connection. No automatic retry occurred.',
      );
    }
    const discrepancy = Boolean(
      officialValues &&
      (officialValues.currencyCode !== reserved.i.currencyCode ||
        !moneyEqual(reserved.i.subtotal, officialValues.subtotal) ||
        !moneyEqual(reserved.i.discountTotal, officialValues.discountTotal) ||
        !moneyEqual(reserved.i.taxTotal, officialValues.taxTotal) ||
        !moneyEqual(reserved.i.grandTotal, officialValues.grandTotal)),
    );
    const accepted = result.status === 'SUBMITTED' || result.status === 'ALREADY_SUBMITTED';
    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.invoice.updateMany({
        where: { id, status: InvoiceStatus.READY_FOR_FAWTARA, submissionLock: reserved.lock },
        data: {
          status: accepted ? InvoiceStatus.FAWTARA_ACCEPTED : InvoiceStatus.FAWTARA_REJECTED,
          submissionLock: null,
          activeDraftKey: accepted ? null : reserved.i.activeDraftKey,
          fawtaraStatus: result.status,
          latestFawtaraMessage: result.message,
          latestFawtaraResultJson: result.results as Prisma.InputJsonValue,
          ...(accepted
            ? {
                officializationProvenance: 'API',
                fawtaraInvoiceNumber: result.number,
                fawtaraInvoiceUuid: result.uuid,
                fawtaraQrPayload: result.qr,
                fawtaraQrImageDataUrl: qrImage,
                fawtaraSubmittedAt: reserved.attempt.submittedAt,
                fawtaraAcceptedAt: new Date(),
                reconciliationRequired: discrepancy,
                officialCurrencyCode: officialValues?.currencyCode,
                officialSubtotal: officialValues?.subtotal,
                officialDiscountTotal: officialValues?.discountTotal,
                officialTaxTotal: officialValues?.taxTotal,
                officialGrandTotal: officialValues?.grandTotal,
              }
            : {}),
        },
      });
      if (changed.count !== 1)
        throw new ConflictException(
          'Invoice result persistence conflict. Do not issue a new invoice.',
        );
      await tx.fawtaraSubmission.update({
        where: { id: reserved.attempt.id },
        data: {
          httpStatus: result.httpStatus,
          einvStatus: result.status,
          results: result.results as Prisma.InputJsonValue,
          message: result.message,
          officialNumber: result.number,
          officialUuid: result.uuid,
          officialQr: result.qr,
          outcome: accepted ? 'ACCEPTED' : 'REJECTED',
          completedAt: new Date(),
        },
      });
      await this.audit.record(
        {
          actorType: ActorType.USER,
          actorId: context.actorId,
          eventKey: accepted ? 'invoice.api_accepted' : 'invoice.api_rejected',
          subjectType: 'Invoice',
          subjectId: id,
          oldState: { status: 'READY_FOR_FAWTARA' },
          newState: {
            status: accepted ? 'FAWTARA_ACCEPTED' : 'FAWTARA_REJECTED',
            officializationProvenance: accepted ? 'API' : null,
          },
          metadata: {
            submissionId: reserved.attempt.id,
            connectionId: reserved.c.id,
            einvStatus: result.status,
            officialValues,
            discrepancy,
            officialValuesSource: officialValues ? 'SIGNED_RESPONSE' : 'NOT_RETURNED',
          },
        },
        tx,
      );
    });
    return this.invoices.findOne(id);
  }
}
