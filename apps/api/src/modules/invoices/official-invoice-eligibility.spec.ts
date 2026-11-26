import { officialInvoiceEvidence, isVerifiedOfficialInvoice } from './official-invoice-eligibility';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    status: 'FAWTARA_ACCEPTED',
    submissionLock: null,
    officializationProvenance: 'MANUAL',
    fawtaraStatus: 'SUBMITTED',
    fawtaraInvoiceNumber: 'INV-100',
    fawtaraAcceptedAt: new Date('2026-11-22T12:00:00.000Z'),
    fawtaraQrImageDataUrl: png,
    officialCurrencyCode: 'JOD',
    officialGrandTotal: { toString: () => '100.000' },
    billingEntityId: 'issuer-1',
    issuerLegalNameSnapshot: 'NUSRV',
    ...overrides,
  };
}

describe('P1 official invoice evidence gate (OD-3 / CL-1 / CL-4)', () => {
  it('recognizes an explicitly recorded invoice with complete official evidence', () => {
    expect(officialInvoiceEvidence(candidate())).toEqual({
      invoiceNumber: 'INV-100', currency: 'JOD', grandTotal: '100.000',
    });
    expect(isVerifiedOfficialInvoice(candidate())).toBe(true);
  });

  it.each([
    ['draft status', { status: 'DRAFT' }],
    ['ready status', { status: 'READY_FOR_FAWTARA' }],
    ['cancelled status', { status: 'CANCELLED' }],
    ['submission lock', { submissionLock: 'busy' }],
    ['missing provenance', { officializationProvenance: null }],
    ['unrecognized provenance', { officializationProvenance: 'INFERRED' }],
    ['unaccepted external status', { fawtaraStatus: 'REJECTED' }],
    ['missing invoice number', { fawtaraInvoiceNumber: null }],
    ['blank invoice number', { fawtaraInvoiceNumber: '   ' }],
    ['missing acceptance timestamp', { fawtaraAcceptedAt: null }],
    ['invalid acceptance timestamp', { fawtaraAcceptedAt: new Date(NaN) }],
    ['invalid QR', { fawtaraQrImageDataUrl: 'data:image/png;base64,AAAA' }],
    ['missing QR', { fawtaraQrImageDataUrl: null }],
    ['missing currency', { officialCurrencyCode: null }],
    ['invalid currency', { officialCurrencyCode: 'JOD/USD' }],
    ['missing official total', { officialGrandTotal: null }],
    ['too many decimal places', { officialGrandTotal: '100.0005' }],
    ['missing legal issuer name', { issuerLegalNameSnapshot: '   ' }],
    ['missing issuer identity', { billingEntityId: '' }],
  ])('rejects %s before collection or renewal fulfillment', (_name, overrides) => {
    expect(officialInvoiceEvidence(candidate(overrides))).toBeNull();
    expect(isVerifiedOfficialInvoice(candidate(overrides))).toBe(false);
  });
});
