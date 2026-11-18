'use client';
import type { InvoiceView } from './invoice-types';
const date = (v: string | null) => v?.slice(0, 10) || '-';
const money = (v: string, c: string) => `${v} ${c}`;
export function InvoiceRenderer({ invoice }: { invoice: InvoiceView }) {
  const official = invoice.status === 'FAWTARA_ACCEPTED';
  if (invoice.status === 'CANCELLED')
    return (
      <p className="no-print">
        Cancelled invoice retained for audit. No customer invoice is available.
      </p>
    );
  if (official && !invoice.finalPrintEnabled)
    return (
      <p className="no-print">
        Final customer document blocked: resolve reconciliation and supply an official graphical QR.
      </p>
    );
  const discrepancy = invoice.officialValueDiscrepancies.length > 0;
  return (
    <article className="invoice-document nusrv-paper">
      {!official && <div className="invoice-draft-banner">DRAFT / NOT OFFICIAL</div>}
      <header className="nusrv-header">
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="nusrv-logo" src="/nusrv-invoice-logo.png" alt="NUSRV" />
          <div className="nusrv-company">
            <p>{invoice.issuerLegalNameSnapshot}</p>
            <p dir="rtl">{invoice.issuerLegalNameArSnapshot}</p>
            <p>{invoice.issuerAddressSnapshot}</p>
          </div>
          <div className="nusrv-rule" />
          <h1>Invoice {invoice.internalReference}</h1>
          <p className="nusrv-ein">
            Electronic Invoice Number: {official ? invoice.fawtaraInvoiceNumber : 'Not issued'}
          </p>
          <dl className="nusrv-meta">
            <dt>Invoice Date:</dt>
            <dd>{date(invoice.invoiceDate)}</dd>
            <dt>Invoice Type:</dt>
            <dd>
              {invoice.invoiceTypeName
                ? invoice.invoiceTypeName.startsWith('1')
                  ? 'Export Invoice'
                  : 'Local Invoice'
                : 'Service Invoice'}
            </dd>
            <dt>Currency Type:</dt>
            <dd>{invoice.effectiveCurrencyCode}</dd>
          </dl>
        </div>
        <div className="nusrv-buyer">
          {official && invoice.fawtaraQrImageDataUrl && (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                className="nusrv-qr"
                src={invoice.fawtaraQrImageDataUrl}
                alt="Official JoFotara QR"
              />
            </>
          )}
          <h2>{invoice.customerNameEnSnapshot || invoice.customerNameArSnapshot}</h2>
          <p>{invoice.customerNameEnSnapshot && invoice.customerNameArSnapshot}</p>
          <p>{invoice.customerPhoneSnapshot}</p>
          <p>
            {invoice.customerAddressSnapshot} {invoice.customerCountrySnapshot}
          </p>
          <p className="nusrv-tax">Sales Tax No.: {invoice.customerTaxNumberSnapshot || '-'}</p>
        </div>
      </header>
      {discrepancy && (
        <div className="nusrv-reconciliation">
          <strong>Reconciled official values</strong>
          <p>
            The line amounts below preserve the original CRM draft. The official totals differ as
            recorded here:
          </p>
          {invoice.officialValueDiscrepancies.map((d) => (
            <p key={d.field}>
              {d.field}: draft {d.crm}; official {d.official}
            </p>
          ))}
        </div>
      )}
      <table className="nusrv-items">
        <thead>
          <tr>
            {['Description', 'Quantity', 'Unit Price', 'Discount', 'Taxes', 'Amount'].map((t) => (
              <th key={t}>{t}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {invoice.lines.map((l) => (
            <tr key={l.id}>
              <td>
                <strong>{l.description}</strong>
                <small>{l.serviceSnapshotText}</small>
                <small>
                  {date(l.periodStart)} to {date(l.periodEnd)}
                </small>
              </td>
              <td>{l.quantity}</td>
              <td>{l.unitPrice}</td>
              <td>{l.discountAmount}</td>
              <td>
                {l.taxRate}%<small>{l.taxAmount}</small>
              </td>
              <td>{money(l.lineTotal, invoice.currencyCode)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="nusrv-totals">
        {[
          ['Total Without Taxes', invoice.effectiveSubtotal],
          ['Discount included', invoice.effectiveDiscountTotal],
          ['Taxes', invoice.effectiveTaxTotal],
          ['Total', invoice.effectiveGrandTotal],
        ].map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{money(v!, invoice.effectiveCurrencyCode)}</dd>
          </div>
        ))}
      </dl>
      <footer className="nusrv-footer">
        <div className="nusrv-bank">{invoice.issuerBankDetailsSnapshot}</div>
        <div className="nusrv-rule" />
        <p>{invoice.issuerInvoiceEmailSnapshot}</p>
        <p>{official && invoice.fawtaraInvoiceUuid}</p>
        <p>{official ? 'Electronic invoice' : 'DRAFT / NOT OFFICIAL'}</p>
      </footer>
    </article>
  );
}
