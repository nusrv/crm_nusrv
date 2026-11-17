'use client';

import type { InvoiceView } from './invoice-types';

const date = (value: string | null) => (value ? value.slice(0, 10) : '—');
const money = (value: string, currency: string) =>
  `${Number(value).toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} ${currency}`;

export function InvoiceRenderer({ invoice }: { invoice: InvoiceView }) {
  const official = invoice.status === 'FAWTARA_ACCEPTED';
  const currency = invoice.effectiveCurrencyCode;

  return (
    <article className="invoice-document">
      {!official && <div className="invoice-draft-banner">DRAFT / NOT OFFICIAL</div>}
      <header className="invoice-document-header">
        <div>
          <p className="invoice-kicker">NUSRV Customer Invoice</p>
          <h1>{invoice.issuerLegalNameSnapshot}</h1>
          {invoice.issuerLegalNameArSnapshot && (
            <p className="invoice-arabic" dir="rtl">
              {invoice.issuerLegalNameArSnapshot}
            </p>
          )}
          <p>{invoice.issuerAddressSnapshot || 'Issuer address not recorded'}</p>
          {invoice.issuerTaxNumberSnapshot && <p>Tax ID: {invoice.issuerTaxNumberSnapshot}</p>}
        </div>
        <div className="invoice-identity">
          <h2>{official ? 'Electronic Invoice' : 'Invoice Preview'}</h2>
          <p>
            <strong>CRM Reference:</strong> {invoice.internalReference}
          </p>
          <p>
            <strong>Electronic Invoice Number:</strong>{' '}
            {invoice.fawtaraInvoiceNumber || 'Not issued'}
          </p>
          {invoice.fawtaraInvoiceUuid && (
            <p className="break-all">
              <strong>UUID:</strong> {invoice.fawtaraInvoiceUuid}
            </p>
          )}
        </div>
      </header>

      {invoice.officialValueDiscrepancies.length > 0 && (
        <section className="invoice-discrepancy">
          <strong>Official values differ from the CRM draft.</strong>
          <p>
            The official JoFotara values shown in totals are authoritative. The draft was not
            silently changed.
          </p>
          <ul>
            {invoice.officialValueDiscrepancies.map((item) => (
              <li key={item.field}>
                {item.field}: CRM {item.crm} → official {item.official}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="invoice-meta-grid">
        <div>
          <h3>Bill To</h3>
          <p>
            <strong>{invoice.customerNameEnSnapshot || invoice.customerNameArSnapshot}</strong>
          </p>
          {invoice.customerNameArSnapshot && invoice.customerNameEnSnapshot && (
            <p dir="rtl">{invoice.customerNameArSnapshot}</p>
          )}
          <p>Customer Code: {invoice.customerCodeSnapshot}</p>
          <p>{invoice.customerAddressSnapshot || 'Address not recorded'}</p>
          <p>{invoice.customerCountrySnapshot || 'Country not recorded'}</p>
          {invoice.customerPhoneSnapshot && <p>{invoice.customerPhoneSnapshot}</p>}
          {invoice.customerTaxNumberSnapshot && <p>Tax ID: {invoice.customerTaxNumberSnapshot}</p>}
        </div>
        <div>
          <h3>Invoice Metadata</h3>
          <p>
            <strong>Invoice Date:</strong> {date(invoice.invoiceDate)}
          </p>
          <p>
            <strong>Invoice Type:</strong> Service invoice
          </p>
          <p>
            <strong>Currency:</strong> {currency}
          </p>
          <p>
            <strong>Service Period:</strong> {date(invoice.periodStart)} to{' '}
            {date(invoice.periodEnd)}
          </p>
        </div>
      </section>

      <table className="invoice-lines-table">
        <thead>
          <tr>
            <th>Description</th>
            <th>Quantity</th>
            <th>Unit Price</th>
            <th>Discount</th>
            <th>Taxes</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          {invoice.lines.map((line) => (
            <tr key={line.id}>
              <td>
                <strong>{line.description}</strong>
                {(line.serviceTypeSnapshot || line.packageSnapshot) && (
                  <small>
                    {[line.serviceTypeSnapshot, line.packageSnapshot].filter(Boolean).join(' · ')}
                  </small>
                )}
                <small>
                  {date(line.periodStart)} to {date(line.periodEnd)}
                </small>
              </td>
              <td>{line.quantity}</td>
              <td>{money(line.unitPrice, invoice.currencyCode)}</td>
              <td>{money(line.discountAmount, invoice.currencyCode)}</td>
              <td>
                {line.taxCategoryCode || 'Not reviewed'}
                {line.taxRate !== null ? ` · ${line.taxRate}%` : ''}
                <small>{money(line.taxAmount, invoice.currencyCode)}</small>
              </td>
              <td>{money(line.lineTotal, invoice.currencyCode)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="invoice-footer-grid">
        <div>
          {invoice.issuerBankDetailsSnapshot && (
            <>
              <h3>Bank Details</h3>
              <p className="whitespace-pre-wrap">{invoice.issuerBankDetailsSnapshot}</p>
            </>
          )}
          {official && invoice.fawtaraQrImageDataUrl && (
            <div className="invoice-qr">
              {/* The supplied image is rendered byte-for-byte; the CRM never regenerates a QR. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img alt="Official JoFotara QR" src={invoice.fawtaraQrImageDataUrl} />
              <span>Official JoFotara QR</span>
            </div>
          )}
          {official && !invoice.fawtaraQrImageDataUrl && invoice.fawtaraQrPayload && (
            <div className="invoice-qr-payload">
              <strong>Official JoFotara QR payload recorded</strong>
              <p>A QR image was not supplied during manual officialization.</p>
              <code>{invoice.fawtaraQrPayload}</code>
            </div>
          )}
        </div>
        <dl className="invoice-totals">
          <div>
            <dt>Total Without Taxes</dt>
            <dd>{money(invoice.effectiveSubtotal, currency)}</dd>
          </div>
          <div>
            <dt>Discount</dt>
            <dd>{money(invoice.effectiveDiscountTotal, currency)}</dd>
          </div>
          <div>
            <dt>Tax</dt>
            <dd>{money(invoice.effectiveTaxTotal, currency)}</dd>
          </div>
          <div className="invoice-grand-total">
            <dt>Total</dt>
            <dd>{money(invoice.effectiveGrandTotal, currency)}</dd>
          </div>
        </dl>
      </section>

      <footer className="invoice-document-footer">
        <p>{invoice.issuerInvoiceEmailSnapshot}</p>
        <p>
          {official
            ? `JoFotara status: ${invoice.fawtaraStatus}`
            : 'This preview is not an official tax invoice.'}
        </p>
      </footer>
    </article>
  );
}
