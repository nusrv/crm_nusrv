import { Injectable } from '@nestjs/common';
import { calculateInvoice, moneyEqual } from './invoice-money';

export type InvoicePreflightStatus = 'PASS' | 'FAIL';

export interface InvoicePreflightCheck {
  code: string;
  label: string;
  status: InvoicePreflightStatus;
  blocking: boolean;
  message: string;
}

export interface InvoicePreflightResult {
  valid: boolean;
  checkedAt: string;
  checks: InvoicePreflightCheck[];
  scopeNote: string;
}

interface PreflightLine {
  description: string;
  quantity: { toString(): string };
  unitPrice: { toString(): string };
  discountAmount: { toString(): string };
  taxCategoryCode: string | null;
  taxRate: { toString(): string } | null;
  lineSubtotal: { toString(): string };
  taxAmount: { toString(): string };
  lineTotal: { toString(): string };
  periodStart: Date | null;
  periodEnd: Date | null;
}

interface PreflightInvoice {
  internalReference: string;
  invoiceDate: Date;
  currencyCode: string;
  periodStart: Date;
  periodEnd: Date;
  customerCodeSnapshot: string;
  customerNameEnSnapshot: string | null;
  customerNameArSnapshot: string | null;
  customerAddressSnapshot: string | null;
  customerCountrySnapshot: string | null;
  issuerLegalNameSnapshot: string;
  issuerTaxNumberSnapshot: string | null;
  issuerAddressSnapshot: string | null;
  subtotal: { toString(): string };
  discountTotal: { toString(): string };
  taxTotal: { toString(): string };
  grandTotal: { toString(): string };
  lines: PreflightLine[];
}

const present = (value: string | null | undefined) => Boolean(value?.trim());
const validPeriod = (start: Date | null, end: Date | null) =>
  Boolean(
    start &&
    end &&
    Number.isFinite(start.getTime()) &&
    Number.isFinite(end.getTime()) &&
    start < end,
  );

@Injectable()
export class InvoicePreflightService {
  validate(invoice: PreflightInvoice): InvoicePreflightResult {
    const checks: InvoicePreflightCheck[] = [];
    const add = (code: string, label: string, pass: boolean, message: string) => {
      checks.push({ code, label, status: pass ? 'PASS' : 'FAIL', blocking: true, message });
    };

    const customerOk =
      present(invoice.customerCodeSnapshot) &&
      (present(invoice.customerNameEnSnapshot) || present(invoice.customerNameArSnapshot)) &&
      present(invoice.customerAddressSnapshot) &&
      present(invoice.customerCountrySnapshot);
    add(
      'CUSTOMER_INFORMATION',
      'Customer information',
      customerOk,
      customerOk
        ? 'Customer code, display name, address, and country are present in the snapshot.'
        : 'Customer code, at least one customer name, address, and country are required.',
    );

    const issuerOk =
      present(invoice.issuerLegalNameSnapshot) &&
      present(invoice.issuerTaxNumberSnapshot) &&
      present(invoice.issuerAddressSnapshot);
    add(
      'ISSUER_INFORMATION',
      'Issuer / Billing Entity',
      issuerOk,
      issuerOk
        ? 'Issuer legal name, tax identifier, and address are present in the snapshot.'
        : 'Issuer legal name, tax identifier, and address are required.',
    );

    const invoiceDateOk = Number.isFinite(invoice.invoiceDate.getTime());
    add(
      'INVOICE_DATE',
      'Invoice date',
      invoiceDateOk,
      invoiceDateOk ? 'Invoice date is valid.' : 'A valid invoice date is required.',
    );

    const currencyOk = /^[A-Z]{3}$/.test(invoice.currencyCode);
    add(
      'CURRENCY',
      'Currency',
      currencyOk,
      currencyOk
        ? `Currency ${invoice.currencyCode} is recorded.`
        : 'A three-letter currency code is required.',
    );

    const linesOk =
      invoice.lines.length > 0 &&
      invoice.lines.every(
        (line) =>
          present(line.description) &&
          Number(line.quantity.toString()) > 0 &&
          Number(line.unitPrice.toString()) >= 0,
      );
    add(
      'INVOICE_LINES',
      'Invoice lines',
      linesOk,
      linesOk
        ? `${invoice.lines.length} invoice line(s) are present.`
        : 'At least one valid line with description, quantity, and unit price is required.',
    );

    const periodsOk =
      validPeriod(invoice.periodStart, invoice.periodEnd) &&
      invoice.lines.every(
        (line) =>
          (line.periodStart === null && line.periodEnd === null) ||
          validPeriod(line.periodStart, line.periodEnd),
      );
    add(
      'SERVICE_PERIOD',
      'Service period',
      periodsOk,
      periodsOk
        ? 'Invoice and line service periods are valid.'
        : 'Service period end must be after its start; line dates must be supplied as a pair.',
    );

    const taxOk =
      invoice.lines.length > 0 &&
      invoice.lines.every(
        (line) =>
          present(line.taxCategoryCode) &&
          line.taxRate !== null &&
          Number(line.taxRate.toString()) >= 0 &&
          Number(line.taxRate.toString()) <= 100,
      );
    add(
      'TAX_TREATMENT',
      'Tax treatment',
      taxOk,
      taxOk
        ? 'Every line has an explicitly reviewed tax category and rate.'
        : 'Every line needs an explicit tax category/code and rate. Missing tax data is never treated as 0%.',
    );

    let calculated: ReturnType<typeof calculateInvoice> | null = null;
    let arithmeticOk = false;
    try {
      calculated = calculateInvoice(
        invoice.lines.map((line) => ({
          description: line.description,
          quantity: line.quantity.toString(),
          unitPrice: line.unitPrice.toString(),
          discountAmount: line.discountAmount.toString(),
          taxCategoryCode: line.taxCategoryCode,
          taxRate: line.taxRate?.toString() ?? null,
        })),
      );
      arithmeticOk = invoice.lines.every((line, index) => {
        const expected = calculated!.lines[index]!;
        return (
          moneyEqual(line.lineSubtotal, expected.lineSubtotal) &&
          moneyEqual(line.taxAmount, expected.taxAmount) &&
          moneyEqual(line.lineTotal, expected.lineTotal)
        );
      });
    } catch {
      arithmeticOk = false;
    }
    add(
      'LINE_ARITHMETIC',
      'Line arithmetic',
      arithmeticOk,
      arithmeticOk
        ? 'All persisted line values match deterministic server calculations.'
        : 'One or more line totals do not match server calculations.',
    );

    const totalsOk = Boolean(
      calculated &&
      moneyEqual(invoice.subtotal, calculated.subtotal) &&
      moneyEqual(invoice.discountTotal, calculated.discountTotal) &&
      moneyEqual(invoice.taxTotal, calculated.taxTotal) &&
      moneyEqual(invoice.grandTotal, calculated.grandTotal),
    );
    add(
      'INVOICE_TOTALS',
      'Invoice totals',
      totalsOk,
      totalsOk
        ? 'Invoice totals match the sum of server-calculated lines.'
        : 'Invoice totals do not match the server-calculated lines.',
    );

    const localFawtaraReadiness =
      present(invoice.internalReference) &&
      issuerOk &&
      (present(invoice.customerNameEnSnapshot) || present(invoice.customerNameArSnapshot)) &&
      taxOk;
    add(
      'REQUIRED_FAWTARA_DATA',
      'Required JoFotara data',
      localFawtaraReadiness,
      localFawtaraReadiness
        ? 'The local fields required by this manual-first foundation are present. Full UBL 2.1 mapping remains a later validated sub-phase.'
        : 'Local JoFotara readiness needs an internal reference, issuer identity/tax data, buyer name, and explicit line tax treatment.',
    );

    return {
      valid: checks.every((check) => !check.blocking || check.status === 'PASS'),
      checkedAt: new Date().toISOString(),
      checks,
      scopeNote:
        'This validates the CRM snapshot and arithmetic only. It does not claim full JoFotara UBL 2.1 compliance or perform a submission.',
    };
  }
}
