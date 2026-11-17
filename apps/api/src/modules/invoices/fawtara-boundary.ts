/**
 * Future JoFotara boundary only. Phase 4A deliberately registers no implementation and contains no
 * fetch/HTTP client. A later adapter must map a locked Invoice snapshot to validated UBL 2.1 and
 * treat EINV_STATUS — never HTTP 200 alone — as the authoritative business result.
 */
export interface FawtaraSubmissionResult {
  status: 'SUBMITTED' | 'ALREADY_SUBMITTED' | 'NOT_SUBMITTED';
  invoiceNumber: string | null;
  invoiceUuid: string | null;
  qrPayload: string | null;
  message: string | null;
  result: Record<string, unknown>;
}

export interface FawtaraMappedInvoice {
  invoiceId: string;
  billingEntityId: string;
  stableSubmissionId: string;
  stableSubmissionUuid: string;
  encodedUblInvoice: string;
}

export interface FawtaraInvoiceMapper {
  map(invoiceId: string): Promise<FawtaraMappedInvoice>;
}

export interface FawtaraGateway {
  submit(invoice: FawtaraMappedInvoice): Promise<FawtaraSubmissionResult>;
}
