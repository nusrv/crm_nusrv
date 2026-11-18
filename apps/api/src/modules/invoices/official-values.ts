import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { z } from 'zod';
import { JoFotaraError } from './jofotara.gateway';
const amount = z
  .union([z.string(), z.object({ '#text': z.string(), '@_currencyID': z.string().optional() })])
  .transform((v) => (typeof v === 'string' ? v : v['#text']))
  .pipe(z.string().regex(/^\d+(?:\.\d{1,3})?$/));
const invoiceSchema = z.object({
  ID: z.string(),
  UUID: z.string(),
  DocumentCurrencyCode: z.string(),
  LegalMonetaryTotal: z.object({
    TaxExclusiveAmount: amount,
    TaxInclusiveAmount: amount,
    AllowanceTotalAmount: amount,
    PayableAmount: amount,
  }),
  TaxTotal: z.object({ TaxAmount: amount }).optional(),
});
const milli = (v: string) => {
  const [w, f = ''] = v.split('.');
  return BigInt(w!) * 1000n + BigInt(f.padEnd(3, '0'));
};
const fmt = (v: bigint) => `${v / 1000n}.${String(v % 1000n).padStart(3, '0')}`;
/** Signed response is evidence, never executable XML. No entities/DTDs or external resources. */
export function parseOfficialValues(encoded: string | undefined, id: string, uuid: string) {
  if (!encoded) return null;
  const xml = Buffer.from(encoded, 'base64').toString('utf8');
  if (
    xml.length > 1000000 ||
    /<!DOCTYPE|<!ENTITY/i.test(xml) ||
    XMLValidator.validate(xml) !== true
  )
    throw new JoFotaraError('MALFORMED_RESPONSE');
  const parsed: unknown = new XMLParser({
    removeNSPrefix: true,
    ignoreAttributes: false,
    parseTagValue: false,
    processEntities: false,
  }).parse(xml);
  const wrapper = z.object({ Invoice: invoiceSchema }).safeParse(parsed);
  if (!wrapper.success) throw new JoFotaraError('MALFORMED_RESPONSE');
  const i = wrapper.data.Invoice;
  if (i.ID !== id || i.UUID !== uuid) throw new JoFotaraError('IDENTITY_MISMATCH');
  const totals = i.LegalMonetaryTotal;
  const net = milli(totals.TaxExclusiveAmount) - milli(totals.AllowanceTotalAmount);
  if (
    net < 0n ||
    milli(totals.PayableAmount) < net ||
    milli(totals.PayableAmount) !== milli(totals.TaxInclusiveAmount) ||
    (i.TaxTotal && net + milli(i.TaxTotal.TaxAmount) !== milli(totals.PayableAmount))
  )
    throw new JoFotaraError('MALFORMED_RESPONSE');
  return {
    currencyCode: i.DocumentCurrencyCode,
    subtotal: fmt(net),
    discountTotal: totals.AllowanceTotalAmount,
    taxTotal: i.TaxTotal?.TaxAmount ?? fmt(milli(totals.PayableAmount) - net),
    grandTotal: totals.PayableAmount,
  };
}
