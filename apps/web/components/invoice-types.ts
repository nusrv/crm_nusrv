export interface InvoiceLineView {
  id: string;
  position: number;
  description: string;
  quantity: string;
  unitPrice: string;
  discountAmount: string;
  taxCategoryCode: string | null;
  taxRate: string | null;
  lineSubtotal: string;
  taxAmount: string;
  lineTotal: string;
  serviceTypeSnapshot: string | null;
  packageSnapshot: string | null;
  serviceSnapshotText: string | null;
  periodStart: string | null;
  periodEnd: string | null;
}

export interface InvoiceView {
  id: string;
  customerId: string;
  billingEntityId: string;
  sourceSubscriptionId: string;
  status: 'DRAFT' | 'READY_FOR_FAWTARA' | 'FAWTARA_ACCEPTED' | 'FAWTARA_REJECTED';
  internalReference: string;
  invoiceDate: string;
  currencyCode: string;
  periodStart: string;
  periodEnd: string;
  customerCodeSnapshot: string;
  customerNameEnSnapshot: string | null;
  customerNameArSnapshot: string | null;
  customerAddressSnapshot: string | null;
  customerCountrySnapshot: string | null;
  customerPhoneSnapshot: string | null;
  customerTaxNumberSnapshot: string | null;
  issuerCodeSnapshot: string;
  issuerLegalNameSnapshot: string;
  issuerLegalNameArSnapshot: string | null;
  issuerTaxNumberSnapshot: string | null;
  issuerAddressSnapshot: string | null;
  issuerInvoiceEmailSnapshot: string | null;
  issuerBankDetailsSnapshot: string | null;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  grandTotal: string;
  fawtaraStatus: string | null;
  fawtaraInvoiceNumber: string | null;
  fawtaraInvoiceUuid: string | null;
  fawtaraQrPayload: string | null;
  fawtaraQrImageDataUrl: string | null;
  fawtaraAcceptedAt: string | null;
  latestFawtaraMessage: string | null;
  officialCurrencyCode: string | null;
  officialSubtotal: string | null;
  officialDiscountTotal: string | null;
  officialTaxTotal: string | null;
  officialGrandTotal: string | null;
  effectiveCurrencyCode: string;
  effectiveSubtotal: string;
  effectiveDiscountTotal: string;
  effectiveTaxTotal: string;
  effectiveGrandTotal: string;
  officialValueDiscrepancies: Array<{ field: string; crm: string; official: string }>;
  locked: boolean;
  lines: InvoiceLineView[];
  customer: { id: string; customerCode: string; nameEn: string | null; nameAr: string | null };
  billingEntity: { id: string; code: string; name: string };
  sourceSubscription: { id: string; subscriptionCode: string; name: string; status: string };
}

export interface InvoicePreflightResult {
  valid: boolean;
  checkedAt: string;
  scopeNote: string;
  checks: Array<{
    code: string;
    label: string;
    status: 'PASS' | 'FAIL';
    blocking: boolean;
    message: string;
  }>;
}
