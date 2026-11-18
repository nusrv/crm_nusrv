import { z } from 'zod';
import {
  INVOICE_DETAIL_KEYS,
  INVOICE_VISIBILITY_KEYS,
  defaultInvoiceVisibility,
  type IssuerPresentation,
} from '@cp/shared';
export const detailsSchema = z
  .object(
    Object.fromEntries(
      INVOICE_DETAIL_KEYS.map((k) => [k, z.string().trim().max(500).optional()]),
    ) as Record<(typeof INVOICE_DETAIL_KEYS)[number], z.ZodOptional<z.ZodString>>,
  )
  .strict();
export const visibilitySchema = z
  .object(
    Object.fromEntries(INVOICE_VISIBILITY_KEYS.map((k) => [k, z.boolean()])) as Record<
      (typeof INVOICE_VISIBILITY_KEYS)[number],
      z.ZodBoolean
    >,
  )
  .strict();
export const saveBrandingSchema = z
  .object({
    expectedRevision: z.number().int().min(0),
    issuerType: z.enum(['COMPANY', 'INDIVIDUAL']),
    legalName: z.string().trim().min(1).max(250),
    legalNameAr: z.string().max(500).nullable(),
    address: z.string().max(1000).nullable(),
    countryCode: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .nullable(),
    taxNumber: z.string().max(100).nullable(),
    invoiceEmail: z.union([z.literal(''), z.email()]).nullable(),
    logoAssetId: z.uuid().nullable(),
    details: detailsSchema,
    visibility: visibilitySchema,
  })
  .strict();
export function snapshotPresentation(
  entity: { issuerType?: string; countryCode?: string | null },
  profile?: {
    revision: number;
    logoAssetId: string | null;
    details: unknown;
    visibility: unknown;
  } | null,
): IssuerPresentation {
  return {
    version: 1,
    profileRevision: profile?.revision ?? 0,
    issuerType: entity.issuerType === 'INDIVIDUAL' ? 'INDIVIDUAL' : 'COMPANY',
    countryCode: entity.countryCode ?? null,
    logoAssetId: profile?.logoAssetId ?? null,
    details: profile ? detailsSchema.parse(profile.details) : {},
    visibility: profile ? visibilitySchema.parse(profile.visibility) : defaultInvoiceVisibility(),
  };
}
