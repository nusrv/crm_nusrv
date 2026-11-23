import { isManualQrImage } from './manual-qr';

export interface OfficialInvoiceEvidenceSource {
  status: string;
  submissionLock: string | null;
  officializationProvenance: string | null;
  fawtaraStatus: string | null;
  fawtaraInvoiceNumber: string | null;
  fawtaraAcceptedAt: Date | null;
  fawtaraQrImageDataUrl: string | null;
  officialCurrencyCode: string | null;
  officialGrandTotal: { toString(): string } | string | null;
  billingEntityId: string;
  issuerLegalNameSnapshot: string;
}

export function officialInvoiceEvidence(invoice: OfficialInvoiceEvidenceSource) {
  const invoiceNumber = invoice.fawtaraInvoiceNumber?.trim();
  const currency = invoice.officialCurrencyCode;
  const grandTotal = invoice.officialGrandTotal?.toString();
  if (
    invoice.status !== 'FAWTARA_ACCEPTED' ||
    invoice.submissionLock ||
    !['MANUAL', 'API'].includes(invoice.officializationProvenance ?? '') ||
    !['SUBMITTED', 'ALREADY_SUBMITTED'].includes(invoice.fawtaraStatus ?? '') ||
    !invoiceNumber ||
    !invoice.fawtaraAcceptedAt ||
    !Number.isFinite(invoice.fawtaraAcceptedAt.getTime()) ||
    !invoice.billingEntityId ||
    !invoice.issuerLegalNameSnapshot?.trim() ||
    !currency ||
    !/^[A-Z]{3}$/.test(currency) ||
    !grandTotal ||
    !/^\d{1,11}(?:\.\d{1,3})?$/.test(grandTotal) ||
    !isManualQrImage(invoice.fawtaraQrImageDataUrl ?? undefined)
  ) {
    return null;
  }
  return { invoiceNumber, currency, grandTotal };
}

export function isVerifiedOfficialInvoice(invoice: OfficialInvoiceEvidenceSource): boolean {
  return officialInvoiceEvidence(invoice) !== null;
}
