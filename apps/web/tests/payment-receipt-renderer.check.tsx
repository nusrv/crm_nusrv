import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PaymentReceiptDocument, type PaymentReceiptView } from '../components/payment-receipt-document';

function receipt(override: Partial<PaymentReceiptView> = {}): PaymentReceiptView {
  return {
    id: 'receipt-01',
    issuerLogoDataUrl: null,
    snapshot: {
      invoiceNumber: 'OFFICIAL-2026-001',
      invoice: {
        issuerLegalNameSnapshot: 'NUSRV HISTORICAL',
        issuerAddressSnapshot: 'Historic issuer address',
        customerNameEnSnapshot: 'Historic Buyer',
      },
    },
    revisions: [
      {
        version: 2,
        amount: '35.000',
        currency: 'JOD',
        paymentDate: '2026-11-23T00:00:00.000Z',
        method: 'BANK_TRANSFER',
        reference: 'REF-01',
        notes: 'Verified transfer',
        voided: false,
        reason: 'Corrected after review',
        actorId: 'admin-1',
        createdAt: '2026-11-23T12:00:00.000Z',
      },
      {
        version: 1,
        amount: '40.000',
        currency: 'JOD',
        paymentDate: '2026-11-20T00:00:00.000Z',
        method: 'BANK_TRANSFER',
        reference: null,
        notes: null,
        voided: false,
        reason: 'Initial receipt',
        actorId: 'admin-1',
        createdAt: '2026-11-20T12:00:00.000Z',
      },
    ],
    ...override,
  };
}

const render = (value: PaymentReceiptView) =>
  renderToStaticMarkup(createElement(PaymentReceiptDocument, { receipt: value }));

const corrected = render(receipt());
assert(corrected.includes('PAYMENT RECEIPT'));
assert(corrected.includes('سند قبض'));
assert(corrected.includes('OFFICIAL-2026-001'));
assert(corrected.includes('NUSRV HISTORICAL'));
assert(corrected.includes('Historic Buyer'));
assert(corrected.includes('35.000 JOD'));
assert(!corrected.includes('40.000 JOD'));
assert(corrected.includes('Print payment receipt'));
assert(!corrected.includes('Official JoFotara QR'));
assert(!corrected.includes('Tax Invoice'));
assert(!corrected.includes('VAT stamp'));
assert(!corrected.includes('disabled=""'));

const voided = receipt();
voided.revisions[0] = { ...voided.revisions[0]!, version: 3, voided: true, reason: 'Void error' };
const voidedHtml = render(voided);
assert(voidedHtml.includes('VOID — NOT VALID AS PAYMENT ACKNOWLEDGEMENT.'));
assert(voidedHtml.includes('disabled=""'));
assert(voidedHtml.includes('This receipt has been voided'));

const unsafe = receipt({
  snapshot: {
    invoiceNumber: '<script>alert(1)</script>',
    invoice: { issuerLegalNameSnapshot: '<img src=x onerror=alert(1)>' },
  },
});
const escaped = render(unsafe);
assert(!escaped.includes('<script>'));
assert(!escaped.includes('<img src=x onerror'));
assert(escaped.includes('&lt;script&gt;'));

console.log('PASS: P1 payment receipt rendering — effective revision, legal snapshot, void guard and escaping.');
