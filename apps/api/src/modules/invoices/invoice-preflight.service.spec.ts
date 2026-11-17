import { InvoicePreflightService } from './invoice-preflight.service';

const decimal = (value: string) => ({ toString: () => value });

function validInvoice() {
  return {
    internalReference: 'NS-INV-2026-000001',
    invoiceDate: new Date('2026-11-17'),
    currencyCode: 'JOD',
    periodStart: new Date('2026-01-01'),
    periodEnd: new Date('2027-01-01'),
    customerCodeSnapshot: 'NS0001',
    customerNameEnSnapshot: 'Example Customer',
    customerNameArSnapshot: null,
    customerAddressSnapshot: 'Amman, Jordan' as string | null,
    customerCountrySnapshot: 'Jordan',
    issuerLegalNameSnapshot: 'New Serve for Digital Data Transformation',
    issuerTaxNumberSnapshot: 'TAX-1' as string | null,
    issuerAddressSnapshot: 'Amman, Jordan',
    subtotal: decimal('100.000'),
    discountTotal: decimal('0.000'),
    taxTotal: decimal('16.000'),
    grandTotal: decimal('116.000'),
    lines: [
      {
        description: 'Hosting',
        quantity: decimal('1.000'),
        unitPrice: decimal('100.000'),
        discountAmount: decimal('0.000'),
        taxCategoryCode: 'STANDARD' as string | null,
        taxRate: decimal('16.0000') as { toString(): string } | null,
        lineSubtotal: decimal('100.000'),
        taxAmount: decimal('16.000'),
        lineTotal: decimal('116.000'),
        periodStart: new Date('2026-01-01'),
        periodEnd: new Date('2027-01-01') as Date | null,
      },
    ],
  };
}

describe('InvoicePreflightService', () => {
  const service = new InvoicePreflightService();

  it('passes a complete, internally consistent manual-first draft', () => {
    const result = service.validate(validInvoice());
    expect(result.valid).toBe(true);
    expect(result.checks).toHaveLength(10);
    expect(result.checks.every((check) => check.status === 'PASS')).toBe(true);
  });

  it('blocks missing customer, issuer, service-period, and explicit tax information', () => {
    const invoice = validInvoice();
    invoice.customerAddressSnapshot = null;
    invoice.issuerTaxNumberSnapshot = null;
    invoice.lines[0]!.taxCategoryCode = null;
    invoice.lines[0]!.taxRate = null;
    invoice.lines[0]!.periodEnd = null;

    const result = service.validate(invoice);
    expect(result.valid).toBe(false);
    expect(
      result.checks.filter((check) => check.status === 'FAIL').map((check) => check.code),
    ).toEqual(
      expect.arrayContaining([
        'CUSTOMER_INFORMATION',
        'ISSUER_INFORMATION',
        'SERVICE_PERIOD',
        'TAX_TREATMENT',
        'REQUIRED_FAWTARA_DATA',
      ]),
    );
  });

  it('detects persisted line arithmetic and invoice-total tampering', () => {
    const invoice = validInvoice();
    invoice.lines[0]!.lineTotal = decimal('999.000');
    invoice.grandTotal = decimal('998.000');

    const result = service.validate(invoice);
    expect(result.valid).toBe(false);
    expect(result.checks.find((check) => check.code === 'LINE_ARITHMETIC')?.status).toBe('FAIL');
    expect(result.checks.find((check) => check.code === 'INVOICE_TOTALS')?.status).toBe('FAIL');
  });
});
