'use client';

// Next uses the automatic JSX runtime; standalone TSX receipt/branding checks
// also support the classic JSX transform and therefore need React in scope.
import React from 'react';

export interface ReceiptRevisionView {
  version: number;
  amount: string;
  paymentDate: string;
  method: string;
  currency: string;
  reference?: string | null;
  notes?: string | null;
  voided: boolean;
  reason: string;
  actorId: string;
  createdAt: string;
}

export interface PaymentReceiptView {
  id: string;
  issuerLogoDataUrl?: string | null;
  snapshot: {
    invoiceNumber?: string;
    invoice?: {
      issuerLegalNameSnapshot?: string | null;
      issuerLegalNameArSnapshot?: string | null;
      issuerAddressSnapshot?: string | null;
      issuerTaxNumberSnapshot?: string | null;
      customerNameEnSnapshot?: string | null;
      customerNameArSnapshot?: string | null;
      customerAddressSnapshot?: string | null;
      officialCurrencyCode?: string | null;
    };
  };
  effective?: ReceiptRevisionView | null;
  revisions: ReceiptRevisionView[];
}

function dateOnly(value: string): string {
  return value.slice(0, 10);
}

/**
 * A payment acknowledgement, NOT the tax invoice. It renders the latest effective
 * receipt revision while keeping the full immutable correction history in the
 * surrounding admin panel. The official number and legal identities are drawn from
 * the original receipt snapshot rather than the customer's current settings.
 *
 * No invoice seal, VAT QR, payment-history export or live company configuration
 * appears on this document.
 */
export function PaymentReceiptDocument({ receipt }: { receipt: PaymentReceiptView }) {
  const effective = receipt.effective ?? receipt.revisions[0] ?? null;
  const invoice = receipt.snapshot.invoice;
  const invoiceNumber = receipt.snapshot.invoiceNumber?.trim() || 'Unspecified';
  const issuer = invoice?.issuerLegalNameSnapshot?.trim() || 'Issuer not available in snapshot';
  const buyer = invoice?.customerNameEnSnapshot?.trim() ||
    invoice?.customerNameArSnapshot?.trim() || 'Customer not available in snapshot';

  return <>
    {effective?.voided && <p role="alert">This receipt has been voided and cannot be printed as a valid payment receipt.</p>}
    {!effective && <p role="alert">No effective receipt revision is recorded. Review this legacy record before printing.</p>}
    <div className="payment-receipt-print">
      <header className="payment-receipt-header">
        {receipt.issuerLogoDataUrl && <img className="payment-receipt-logo" src={receipt.issuerLogoDataUrl} alt="Issuer logo" />}
        <div>
          <h2>PAYMENT RECEIPT</h2>
          <p lang="ar" dir="rtl">سند قبض</p>
        </div>
        <p className="payment-receipt-id">Receipt ID: {receipt.id}</p>
      </header>

      <section className="payment-receipt-parties">
        <div>
          <strong>Received by / المستلم</strong>
          <p>{issuer}</p>
          {invoice?.issuerLegalNameArSnapshot && <p lang="ar" dir="rtl">{invoice.issuerLegalNameArSnapshot}</p>}
          {invoice?.issuerAddressSnapshot && <p>{invoice.issuerAddressSnapshot}</p>}
        </div>
        <div>
          <strong>Received from / الدافع</strong>
          <p>{buyer}</p>
          {invoice?.customerNameArSnapshot && buyer !== invoice.customerNameArSnapshot &&
            <p lang="ar" dir="rtl">{invoice.customerNameArSnapshot}</p>}
          {invoice?.customerAddressSnapshot && <p>{invoice.customerAddressSnapshot}</p>}
        </div>
      </section>

      <dl className="payment-receipt-details">
        <div><dt>Official invoice / رقم الفاتورة</dt><dd>{invoiceNumber}</dd></div>
        <div><dt>Receipt version / إصدار السند</dt><dd>{effective?.version ?? '—'}</dd></div>
        <div><dt>Payment date / تاريخ الدفع</dt><dd>{effective ? dateOnly(effective.paymentDate) : '—'}</dd></div>
        <div><dt>Payment method / طريقة الدفع</dt><dd>{effective?.method?.replaceAll('_', ' ') ?? '—'}</dd></div>
        {effective?.reference && <div><dt>Payment reference / مرجع الدفع</dt><dd>{effective.reference}</dd></div>}
      </dl>

      <div className="payment-receipt-amount">
        <span>Amount received / المبلغ المقبوض</span>
        <strong>{effective?.amount ?? '—'} {effective?.currency ?? ''}</strong>
      </div>
      {effective?.notes && <p className="payment-receipt-note">Notes: {effective.notes}</p>}

      <footer className="payment-receipt-footer">
        This document acknowledges a payment against the official invoice shown above.
        It is not a tax invoice and does not replace the issuer's official invoice.
        {effective?.voided ? ' VOID — NOT VALID AS PAYMENT ACKNOWLEDGEMENT.' : ''}
      </footer>
    </div>
    <div className="no-print mt-4">
      <button
        type="button"
        className="button-secondary"
        disabled={!effective || effective.voided}
        onClick={() => window.print()}
      >
        Print payment receipt
      </button>
    </div>
  </>;
}
