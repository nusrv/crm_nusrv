import type { InvoiceSnapshot } from './fawtara-mapper';
export interface FawtaraMappedInvoice {
  xml: string;
  hash: string;
  encodedUblInvoice: string;
}
export interface FawtaraSubmissionResult {
  httpStatus: number;
  status: 'SUBMITTED' | 'ALREADY_SUBMITTED' | 'NOT_SUBMITTED';
  number: string | null;
  uuid: string | null;
  qr: string | null;
  message: string | null;
  results: Record<string, unknown>;
  signedInvoice?: string;
}
export interface FawtaraInvoiceMapper {
  readiness(invoice: InvoiceSnapshot): string[];
  map(invoice: InvoiceSnapshot, incomeSourceSequence: string): FawtaraMappedInvoice;
}
export interface FawtaraGateway {
  submit(
    encodedUblInvoice: string,
    credentials: { clientId: string; secretKey: string },
  ): Promise<FawtaraSubmissionResult>;
}
