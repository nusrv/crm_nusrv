import { PNG } from 'pngjs';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { ActorType } from '../../generated/prisma/enums';
import type { MutationContext } from '../../common/mutation-context';
import { saveBrandingSchema, snapshotPresentation } from './invoice-branding.schema';
export function validateLogo(file: { buffer: Buffer; mimetype: string } | undefined) {
  if (
    !file ||
    file.mimetype !== 'image/png' ||
    file.buffer.length > 262144 ||
    file.buffer.length < 24 ||
    file.buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
    file.buffer.subarray(12, 16).toString() !== 'IHDR'
  )
    throw new BadRequestException('Logo must be a PNG image, maximum 256 KB.');
  const w = file.buffer.readUInt32BE(16),
    h = file.buffer.readUInt32BE(20);
  if (!w || !h || w > 4096 || h > 4096)
    throw new BadRequestException('Logo dimensions must be between 1 and 4096 pixels.');
  try {
    PNG.sync.read(file.buffer, { checkCRC: true });
  } catch {
    throw new BadRequestException('Logo PNG is corrupt or cannot be decoded.');
  }
  return file.buffer;
}
@Injectable()
export class InvoiceBrandingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}
  async get(billingEntityId: string) {
    const e = await this.prisma.billingEntity.findUnique({
      where: { id: billingEntityId },
      include: { invoiceBranding: { include: { logoAsset: true } } },
    });
    if (!e) throw new NotFoundException('Billing Entity not found.');
    const snapshot = snapshotPresentation(e, e.invoiceBranding);
    return {
      billingEntityId: e.id,
      code: e.code,
      issuerType: e.issuerType,
      legalName: e.legalName,
      legalNameAr: e.legalNameAr,
      address: e.address,
      countryCode: e.countryCode,
      taxNumber: e.taxNumber,
      invoiceEmail: e.invoiceEmail,
      expectedRevision: snapshot.profileRevision,
      details: snapshot.details,
      visibility: snapshot.visibility,
      logoAssetId: snapshot.logoAssetId,
      logoDataUrl: e.invoiceBranding?.logoAsset
        ? `data:image/png;base64,${Buffer.from(e.invoiceBranding.logoAsset.bytes).toString('base64')}`
        : null,
    };
  }
  async uploadLogo(
    billingEntityId: string,
    file: { buffer: Buffer; mimetype: string } | undefined,
    context: MutationContext,
  ) {
    const bytes = validateLogo(file),
      sha256 = createHash('sha256').update(bytes).digest('hex');
    return this.prisma.$transaction(async (tx) => {
      if (!(await tx.billingEntity.findUnique({ where: { id: billingEntityId } })))
        throw new NotFoundException('Billing Entity not found.');
      const asset = await tx.invoiceBrandingAsset.upsert({
        where: { billingEntityId_sha256: { billingEntityId, sha256 } },
        create: { billingEntityId, sha256, mimeType: 'image/png', bytes: Uint8Array.from(bytes) },
        update: {},
      });
      await this.audit.record(
        {
          actorType: ActorType.USER,
          actorId: context.actorId,
          eventKey: 'invoice_branding.logo_uploaded',
          subjectType: 'BillingEntity',
          subjectId: billingEntityId,
          metadata: { assetId: asset.id, sha256 },
          ipAddress: context.ipAddress,
        },
        tx,
      );
      return { id: asset.id, sha256 };
    });
  }
  async save(billingEntityId: string, raw: unknown, context: MutationContext) {
    const parsed = saveBrandingSchema.safeParse(raw);
    if (!parsed.success)
      throw new BadRequestException('Invalid invoice branding fields or visibility settings.');
    const input = parsed.data;
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM billing_entities WHERE id = ${billingEntityId} FOR UPDATE`;
      const old = await tx.billingEntity.findUnique({
        where: { id: billingEntityId },
        include: { invoiceBranding: true },
      });
      if (!old) throw new NotFoundException('Billing Entity not found.');
      if ((old.invoiceBranding?.revision ?? 0) !== input.expectedRevision)
        throw new ConflictException('Branding changed concurrently. Reload before saving.');
      if (
        input.logoAssetId &&
        !(await tx.invoiceBrandingAsset.findFirst({
          where: { id: input.logoAssetId, billingEntityId },
        }))
      )
        throw new BadRequestException('Logo does not belong to this Billing Entity.');
      const { details, visibility, expectedRevision, logoAssetId, ...identity } = input;
      await tx.billingEntity.update({ where: { id: billingEntityId }, data: identity });
      const profile = await tx.invoiceBrandingProfile.upsert({
        where: { billingEntityId },
        create: { billingEntityId, revision: 1, details, visibility, logoAssetId },
        update: { revision: { increment: 1 }, details, visibility, logoAssetId },
      });
      // Explicit allowlist: no BillingEntity ciphertext, connection records or binary data in audit.
      await this.audit.record(
        {
          actorType: ActorType.USER,
          actorId: context.actorId,
          eventKey: 'invoice_branding.profile_saved',
          subjectType: 'BillingEntity',
          subjectId: billingEntityId,
          oldState: {
            issuerType: old.issuerType,
            legalName: old.legalName,
            legalNameAr: old.legalNameAr,
            address: old.address,
            countryCode: old.countryCode,
            taxNumber: old.taxNumber,
            invoiceEmail: old.invoiceEmail,
            presentation: snapshotPresentation(old, old.invoiceBranding),
          },
          newState: { ...identity, presentation: snapshotPresentation(identity, profile) },
          metadata: {
            previousRevision: expectedRevision,
            logoReplaced: old.invoiceBranding?.logoAssetId !== logoAssetId,
            visibilityChanged:
              JSON.stringify(old.invoiceBranding?.visibility) !== JSON.stringify(visibility),
          },
          ipAddress: context.ipAddress,
        },
        tx,
      );
    });
    return this.get(billingEntityId);
  }
}
