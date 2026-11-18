import type { FawtaraInvoiceMapper } from './fawtara-boundary';
import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Invoice, InvoiceLine } from '../../generated/prisma/client';
type XmlValue = string | number | bigint | { toString(): string } | null | undefined;
const x = (v: XmlValue) =>
  (v?.toString() ?? '').replace(
    /[<>&"']/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!,
  );
export type InvoiceSnapshot = Invoice & { lines: InvoiceLine[] };
/** ISTD v1.5: income/general sales invoices only. Special tax/returns are deliberately rejected. */
@Injectable()
export class FawtaraMapper implements FawtaraInvoiceMapper {
  readiness(i: InvoiceSnapshot): string[] {
    const errors: string[] = [];
    if (!['011', '021', '111', '121', '012', '022', '112', '122'].includes(i.invoiceTypeName ?? ''))
      errors.push(
        'Select a supported income/general local or export cash/receivable invoice type.',
      );
    if (!i.invoiceCounter || !i.submissionUuid)
      errors.push('Stable invoice counter and UUID are required.');
    if (!i.issuerTaxNumberSnapshot || !/^\d+$/.test(i.issuerTaxNumberSnapshot))
      errors.push('Issuer tax number must be numeric.');
    if (i.issuerCountryCodeSnapshot !== 'JO') errors.push('Issuer country must be explicitly JO.');
    if (!/^[A-Z]{2}$/.test(i.buyerCountryCodeSnapshot ?? ''))
      errors.push('Explicit buyer ISO country code is required.');
    if (i.customerTaxNumberSnapshot && !/^\d+$/.test(i.customerTaxNumberSnapshot))
      errors.push('Buyer tax number must be numeric when supplied.');
    if (
      ![
        'JOD',
        'USD',
        'EUR',
        'SAR',
        'AED',
        'OMR',
        'GBP',
        'QAR',
        'KWD',
        'BHD',
        'AUD',
        'CAD',
        'JPY',
        'CHF',
        'TRY',
        'SYP',
        'EGP',
        'SEK',
      ].includes(i.currencyCode)
    )
      errors.push('Currency is not documented by ISTD.');
    if (!i.customerNameEnSnapshot && !i.customerNameArSnapshot) errors.push('Buyer name required.');
    if (i.lines.length === 0) errors.push('Invoice lines required.');
    for (const l of i.lines) {
      if (Number(l.unitPrice.toString()) <= 0 || Number(l.quantity.toString()) <= 0)
        errors.push('Documented invoice quantity and unit price must be greater than zero.');
      const r = Number(l.taxRate?.toString());
      if (i.invoiceTypeName?.endsWith('1')) {
        if (l.taxCategoryCode !== 'INCOME' || r !== 0 || l.taxRate === null)
          errors.push('Income invoice needs explicit INCOME treatment and zero tax rate.');
      } else if (
        !(['Z', 'O'].includes(l.taxCategoryCode ?? '') && r === 0) &&
        !(l.taxCategoryCode === 'S' && [1, 2, 3, 4, 5, 7, 8, 10, 16].includes(r))
      )
        errors.push('General sales tax requires explicit ISTD S/Z/O category and documented rate.');
      if (i.invoiceTypeName?.startsWith('1') && r !== 0)
        errors.push('Export requires explicitly reviewed zero tax.');
    }
    return [...new Set(errors)];
  }
  map(i: InvoiceSnapshot, incomeSourceSequence: string) {
    const errors = this.readiness(i);
    if (!/^\d+$/.test(incomeSourceSequence)) errors.push('Income Source Sequence required.');
    if (errors.length)
      throw new BadRequestException({ message: 'UBL mapping is not ready.', errors });
    const general = i.invoiceTypeName!.endsWith('2');
    // ISTD monetary attributes use JO in examples while document/tax currency use JOD.
    const currency = i.currencyCode === 'JOD' ? 'JO' : i.currencyCode;
    const amount = (tag: string, v: XmlValue) =>
      `<cbc:${tag} currencyID="${x(currency)}">${x(v)}</cbc:${tag}>`;
    const allowance = (v: XmlValue, reason: string) =>
      `<cac:AllowanceCharge><cbc:ChargeIndicator>false</cbc:ChargeIndicator><cbc:AllowanceChargeReason>${reason}</cbc:AllowanceChargeReason>${amount('Amount', v)}</cac:AllowanceCharge>`;
    const taxScheme = '<cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>';
    const buyerTax = i.customerTaxNumberSnapshot
      ? `<cac:PartyIdentification><cbc:ID schemeID="TN">${x(i.customerTaxNumberSnapshot)}</cbc:ID></cac:PartyIdentification>`
      : '';
    // CRM subtotal is net of discount; ISTD TaxExclusiveAmount is before discount.
    const milli = (v: { toString(): string }) => {
      const [w, f = ''] = v.toString().split('.');
      return BigInt(w!) * 1000n + BigInt(f.padEnd(3, '0'));
    };
    const fmt = (v: bigint) => `${v / 1000n}.${String(v % 1000n).padStart(3, '0')}`;
    const xml = `<?xml version="1.0" encoding="UTF-8"?><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"><cbc:ProfileID>reporting:1.0</cbc:ProfileID><cbc:ID>${x(i.internalReference)}</cbc:ID><cbc:UUID>${x(i.submissionUuid)}</cbc:UUID><cbc:IssueDate>${i.invoiceDate.toISOString().slice(0, 10)}</cbc:IssueDate><cbc:InvoiceTypeCode name="${x(i.invoiceTypeName)}">388</cbc:InvoiceTypeCode><cbc:DocumentCurrencyCode>${x(i.currencyCode)}</cbc:DocumentCurrencyCode><cbc:TaxCurrencyCode>${x(i.currencyCode)}</cbc:TaxCurrencyCode><cac:AdditionalDocumentReference><cbc:ID>ICV</cbc:ID><cbc:UUID>${x(i.invoiceCounter)}</cbc:UUID></cac:AdditionalDocumentReference><cac:AccountingSupplierParty><cac:Party><cac:PostalAddress><cac:Country><cbc:IdentificationCode>${x(i.issuerCountryCodeSnapshot)}</cbc:IdentificationCode></cac:Country></cac:PostalAddress><cac:PartyTaxScheme><cbc:CompanyID>${x(i.issuerTaxNumberSnapshot)}</cbc:CompanyID>${taxScheme}</cac:PartyTaxScheme><cac:PartyLegalEntity><cbc:RegistrationName>${x(i.issuerLegalNameSnapshot)}</cbc:RegistrationName></cac:PartyLegalEntity></cac:Party></cac:AccountingSupplierParty><cac:AccountingCustomerParty><cac:Party>${buyerTax}<cac:PostalAddress><cac:Country><cbc:IdentificationCode>${x(i.buyerCountryCodeSnapshot)}</cbc:IdentificationCode></cac:Country></cac:PostalAddress><cac:PartyTaxScheme>${taxScheme}</cac:PartyTaxScheme><cac:PartyLegalEntity><cbc:RegistrationName>${x(i.customerNameEnSnapshot || i.customerNameArSnapshot)}</cbc:RegistrationName></cac:PartyLegalEntity></cac:Party></cac:AccountingCustomerParty><cac:SellerSupplierParty><cac:Party><cac:PartyIdentification><cbc:ID>${x(incomeSourceSequence)}</cbc:ID></cac:PartyIdentification></cac:Party></cac:SellerSupplierParty>${allowance(i.discountTotal, 'discount')}${general ? `<cac:TaxTotal>${amount('TaxAmount', i.taxTotal)}</cac:TaxTotal>` : ''}<cac:LegalMonetaryTotal>${amount('TaxExclusiveAmount', fmt(milli(i.subtotal) + milli(i.discountTotal)))}${amount('TaxInclusiveAmount', i.grandTotal)}${amount('AllowanceTotalAmount', i.discountTotal)}${amount('PayableAmount', i.grandTotal)}</cac:LegalMonetaryTotal>${i.lines.map((l) => `<cac:InvoiceLine><cbc:ID>${l.position}</cbc:ID><cbc:InvoicedQuantity unitCode="PCE">${x(l.quantity)}</cbc:InvoicedQuantity>${amount('LineExtensionAmount', l.lineSubtotal)}${general ? `<cac:TaxTotal>${amount('TaxAmount', l.taxAmount)}${amount('RoundingAmount', l.lineTotal)}<cac:TaxSubtotal>${amount('TaxAmount', l.taxAmount)}<cac:TaxCategory><cbc:ID schemeAgencyID="6" schemeID="UN/ECE 5305">${x(l.taxCategoryCode)}</cbc:ID><cbc:Percent>${x(l.taxRate)}</cbc:Percent><cac:TaxScheme><cbc:ID schemeAgencyID="6" schemeID="UN/ECE 5153">VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal></cac:TaxTotal>` : ''}<cac:Item><cbc:Name>${x(l.description)}</cbc:Name></cac:Item><cac:Price>${amount('PriceAmount', l.unitPrice)}${allowance(l.discountAmount, 'DISCOUNT')}</cac:Price></cac:InvoiceLine>`).join('')}</Invoice>`;
    return {
      xml,
      hash: createHash('sha256').update(xml, 'utf8').digest('hex'),
      encodedUblInvoice: Buffer.from(xml, 'utf8').toString('base64'),
    };
  }
}
