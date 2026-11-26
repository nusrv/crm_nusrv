'use client';

import { workspaceStatus } from '../lib/workspace-status';

import Link from 'next/link';
import {
  readIssuerPresentation,
  defaultInvoiceVisibility,
  type InvoiceVisibility,
} from '@cp/shared';
import { InvoiceVisibilityEditor } from './invoice-visibility-editor';
import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '../lib/api';
import { InvoiceRenderer } from './invoice-renderer';
import type { InvoiceLineView, InvoicePreflightResult, InvoiceView } from './invoice-types';
import { Notice } from './notice';
import { PageHeading } from './page-heading';
import { useControlPanel } from './app-shell';
import { InvoicePaymentsPanel } from './invoice-payments-panel';
import { InvoiceQrRecovery } from './p1-recovery-panels';

type EditableLine = Pick<
  InvoiceLineView,
  | 'description'
  | 'quantity'
  | 'unitPrice'
  | 'discountAmount'
  | 'taxCategoryCode'
  | 'taxRate'
  | 'periodStart'
  | 'periodEnd'
>;

const dateInput = (value: string | null) => (value ? value.slice(0, 10) : '');
const localDateTimeInput = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

export function InvoiceDetail({ invoiceId }: { invoiceId: string }) {
  const { can } = useControlPanel();
  const admin = can('ADMIN');
  const [invoice, setInvoice] = useState<InvoiceView | null>(null);
  const [lines, setLines] = useState<EditableLine[]>([]);
  const [preflight, setPreflight] = useState<InvoicePreflightResult | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [visibility, setVisibility] = useState<InvoiceVisibility>(defaultInvoiceVisibility());
  const [qrImageDataUrl, setQrImageDataUrl] = useState('');
  const [history, setHistory] = useState<
    Array<{
      id: string;
      attemptNumber: number;
      outcome: string;
      einvStatus: string | null;
      message: string | null;
      requestXmlHash: string;
      connectionNameSnapshot: string;
      createdAt: string;
    }>
  >([]);
  const [rejectionMessage, setRejectionMessage] = useState('');

  const load = useCallback(async () => {
    const value = await apiRequest<InvoiceView>(`/invoices/${invoiceId}`);
    setInvoice(value);
    setVisibility(
      readIssuerPresentation(value.issuerPresentationSnapshot)?.visibility ??
        defaultInvoiceVisibility(),
    );
    setHistory(await apiRequest(`/invoices/${invoiceId}/submissions`));
    setLines(
      value.lines.map((line) => ({
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discountAmount: line.discountAmount,
        taxCategoryCode: line.taxCategoryCode,
        taxRate: line.taxRate,
        periodStart: line.periodStart,
        periodEnd: line.periodEnd,
      })),
    );
  }, [invoiceId]);

  useEffect(() => {
    // The state updates happen after the API promise resolves; this effect only starts the load.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load().catch((cause: unknown) =>
      setError(cause instanceof Error ? cause.message : 'Unable to load invoice.'),
    );
  }, [load]);

  const run = async (action: () => Promise<unknown>, success: string) => {
    setError('');
    setMessage('');
    try {
      await action();
      await load();
      setMessage(success);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Action failed.');
      await load().catch(() => undefined);
    }
  };

  async function validate() {
    setError('');
    try {
      const result = await apiRequest<InvoicePreflightResult>(`/invoices/${invoiceId}/preflight`, {
        method: 'POST',
      });
      setPreflight(result);
      return result;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Preflight failed.');
      return null;
    }
  }

  async function saveDraft(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await run(
      () =>
        apiRequest(`/invoices/${invoiceId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            invoiceDate: String(form.get('invoiceDate')),
            presentationVisibility: visibility,
            invoiceTypeName: String(form.get('invoiceTypeName')) || undefined,
            issuerCountryCode: String(form.get('issuerCountryCode')) || undefined,
            buyerCountryCode: String(form.get('buyerCountryCode')) || undefined,
            issuerBankDetails: form.has('issuerBankDetails')
              ? String(form.get('issuerBankDetails'))
              : undefined,
            issuerLegalNameAr: String(form.get('issuerLegalNameAr') ?? ''),
            periodStart: String(form.get('periodStart')),
            periodEnd: String(form.get('periodEnd')),
            customerNameEn: String(form.get('customerNameEn') ?? ''),
            customerNameAr: String(form.get('customerNameAr') ?? ''),
            customerAddress: String(form.get('customerAddress') ?? ''),
            customerCountry: String(form.get('customerCountry') ?? ''),
            customerPhone: String(form.get('customerPhone') ?? ''),
            customerTaxNumber: String(form.get('customerTaxNumber') ?? ''),
            lines: lines.map((line) => ({
              ...line,
              taxCategoryCode: line.taxCategoryCode || undefined,
              taxRate: line.taxRate || undefined,
              periodStart: dateInput(line.periodStart),
              periodEnd: dateInput(line.periodEnd),
            })),
          }),
        }),
      'Draft saved. Totals were recalculated on the server.',
    );
    setPreflight(null);
  }

  function updateLine(index: number, field: keyof EditableLine, value: string) {
    setLines((current) =>
      current.map((line, lineIndex) => (lineIndex === index ? { ...line, [field]: value } : line)),
    );
  }

  function addLine() {
    setLines((current) => [
      ...current,
      {
        description: '',
        quantity: '1.000',
        unitPrice: '0.000',
        discountAmount: '0.000',
        taxCategoryCode: null,
        taxRate: null,
        periodStart: invoice?.periodStart ?? null,
        periodEnd: invoice?.periodEnd ?? null,
      },
    ]);
  }

  async function markReady() {
    const result = await validate();
    if (!result?.valid) {
      setError('Resolve every blocking preflight failure before marking the invoice ready.');
      return;
    }
    await run(
      () => apiRequest(`/invoices/${invoiceId}/mark-ready`, { method: 'POST' }),
      'Invoice ready to record official details.',
    );
  }

  async function recordResult(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const optional = (name: string) => String(form.get(name) ?? '').trim() || undefined;
    if (!qrImageDataUrl) {
      setError('Load the official QR image first.');
      return;
    }
    const acceptedAt = new Date(String(form.get('acceptedAt')));
    if (!Number.isFinite(acceptedAt.getTime())) {
      setError('Enter a valid acceptance date.');
      return;
    }
    await run(
      () =>
        apiRequest(`/invoices/${invoiceId}/officialize`, {
          method: 'POST',
          body: JSON.stringify({
            fawtaraStatus: String(form.get('fawtaraStatus')),
            invoiceNumber: String(form.get('invoiceNumber')),
            invoiceUuid: optional('invoiceUuid'),
            qrPayload: optional('qrPayload'),
            qrImageDataUrl: qrImageDataUrl || undefined,
            acceptedAt: acceptedAt.toISOString(),
            officialCurrencyCode: optional('officialCurrencyCode'),
            officialSubtotal: optional('officialSubtotal'),
            officialDiscountTotal: optional('officialDiscountTotal'),
            officialTaxTotal: optional('officialTaxTotal'),
            officialGrandTotal: optional('officialGrandTotal'),
            note: optional('note'),
          }),
        }),
      'Official JoFotara result recorded. The invoice is now locked.',
    );
  }

  function loadQrImage(file: File | undefined) {
    if (!file) return;
    if (file.size > 40000) {
      setError('QR image must be 40 KB or smaller.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setQrImageDataUrl(String(reader.result ?? ''));
    reader.onerror = () => setError('Unable to read the QR image.');
    reader.readAsDataURL(file);
  }

  if (!invoice)
    return (
      <>
        <Notice message={error} />
        <p>Loading invoice…</p>
      </>
    );

  return (
    <div className="invoice-workspace">
      <PageHeading
        eyebrow="Manual invoice recording"
        title={invoice.internalReference}
        description={`${workspaceStatus(invoice.status)} · ${invoice.customerCodeSnapshot} · ${invoice.sourceSubscription?.name ?? 'Independent invoice'}`}
        actions={
          <div className="no-print flex gap-2">
            <Link className="button-secondary" href="/dashboard/invoices">
              Back to invoices
            </Link>
            <button
              className="button-primary"
              disabled={
                invoice.status === 'CANCELLED' ||
                (invoice.status === 'FAWTARA_ACCEPTED' && !invoice.finalPrintEnabled)
              }
              onClick={() => window.print()}
              type="button"
            >
              Print / Save PDF
            </button>
          </div>
        }
      />
      <div className="no-print">
        <Notice message={error} />
        <Notice message={message} tone="success" />
      </div>

      <div className="panel no-print mb-6">
        {invoice.officializationProvenance && (
          <p>Officialization: {invoice.officializationProvenance}</p>
        )}
        {admin && invoice.status === 'DRAFT' && (
          <button
            className="button-secondary"
            onClick={() => {
              const reason = window.prompt('Mandatory cancellation reason');
              if (
                reason?.trim() &&
                window.confirm('Permanently cancel this draft? It will be retained for audit.')
              )
                void run(
                  () =>
                    apiRequest(`/invoices/${invoiceId}/cancel-draft`, {
                      method: 'POST',
                      body: JSON.stringify({ reason }),
                    }),
                  'Draft cancelled.',
                );
            }}
          >
            Cancel draft
          </button>
        )}
        {admin && invoice.reconciliationRequired && (
          <button
            className="button-secondary"
            onClick={() => {
              const reason = window.prompt(
                'Review draft and official discrepancies. Enter reconciliation explanation. The final document will explicitly disclose both values.',
              );
              if (
                reason?.trim() &&
                window.confirm('Confirm reconciliation of the recorded discrepancies?')
              )
                void run(
                  () =>
                    apiRequest(`/invoices/${invoiceId}/reconcile`, {
                      method: 'POST',
                      body: JSON.stringify({ reason }),
                    }),
                  'Reconciliation recorded.',
                );
            }}
          >
            Reconcile official values
          </button>
        )}
        {invoice.officialValueDiscrepancies.map((d) => (
          <p key={d.field}>
            {d.field}: CRM {d.crm}; official {d.official}
          </p>
        ))}
      </div>
      {admin && invoice.status === 'DRAFT' && (
        <section className="panel no-print mb-6">
          <h3 className="text-xl font-semibold">Review and edit draft snapshot</h3>
          <p className="muted mt-1 text-sm">
            Relationships and issuer identity are fixed. Editing this snapshot never changes the
            source Customer or Subscription.
          </p>
          <form className="form-grid mt-5" onSubmit={(event) => void saveDraft(event)}>
            <div className="field-wide">
              <InvoiceVisibilityEditor value={visibility} onChange={setVisibility} />
              <p>
                Only this DRAFT snapshot changes. Issuer profile defaults and tax payload fields are
                unaffected.
              </p>
            </div>
            <label>
              Official invoice profile
              <select name="invoiceTypeName" defaultValue={invoice.invoiceTypeName || ''} required>
                <option value="">Select explicitly</option>
                {[
                  ['011', 'Income local cash'],
                  ['021', 'Income local receivable'],
                  ['111', 'Income export cash'],
                  ['121', 'Income export receivable'],
                  ['012', 'General local cash'],
                  ['022', 'General local receivable'],
                  ['112', 'General export cash'],
                  ['122', 'General export receivable'],
                ].map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <Field
              label="Issuer ISO country code"
              name="issuerCountryCode"
              value={invoice.issuerCountryCodeSnapshot || ''}
              required
            />
            <Field
              label="Buyer ISO country code"
              name="buyerCountryCode"
              value={invoice.buyerCountryCodeSnapshot || ''}
              required
            />
            <Field
              label="Issuer Arabic legal name"
              name="issuerLegalNameAr"
              value={invoice.issuerLegalNameArSnapshot || ''}
            />
            {!readIssuerPresentation(invoice.issuerPresentationSnapshot) ? (
              <label>
                Legacy bank details (invoice snapshot)
                <textarea
                  name="issuerBankDetails"
                  defaultValue={invoice.issuerBankDetailsSnapshot || ''}
                />
              </label>
            ) : (
              <p className="field-wide">
                Issuer bank/contact values were snapshotted at creation. Use print checkboxes to
                show/hide them; master edits affect future invoices only.
              </p>
            )}
            <p>
              General categories: S = taxed, Z = exempt, O = zero rated. Income profile: explicit
              INCOME and rate 0.
            </p>

            <Field
              label="Invoice date"
              name="invoiceDate"
              required
              type="date"
              value={dateInput(invoice.invoiceDate)}
            />
            <Field
              label="Service period start"
              name="periodStart"
              required
              type="date"
              value={dateInput(invoice.periodStart)}
            />
            <Field
              label="Service period end"
              name="periodEnd"
              required
              type="date"
              value={dateInput(invoice.periodEnd)}
            />
            <Field
              label="Customer English name"
              name="customerNameEn"
              value={invoice.customerNameEnSnapshot ?? ''}
            />
            <Field
              label="Customer Arabic name"
              name="customerNameAr"
              value={invoice.customerNameArSnapshot ?? ''}
            />
            <Field
              label="Customer country"
              name="customerCountry"
              value={invoice.customerCountrySnapshot ?? ''}
            />
            <Field
              label="Customer phone"
              name="customerPhone"
              value={invoice.customerPhoneSnapshot ?? ''}
            />
            <Field
              label="Customer tax identifier"
              name="customerTaxNumber"
              value={invoice.customerTaxNumberSnapshot ?? ''}
            />
            <label className="field field-wide">
              <span>Customer address</span>
              <textarea
                defaultValue={invoice.customerAddressSnapshot ?? ''}
                name="customerAddress"
                rows={3}
              />
            </label>

            <div className="field-wide mt-3 flex items-center justify-between">
              <h4 className="font-semibold">Invoice lines</h4>
              <button className="button-small" onClick={addLine} type="button">
                Add line
              </button>
            </div>
            {lines.map((line, index) => (
              <div className="field-wide rounded-xl border border-[var(--line)] p-4" key={index}>
                <div className="form-grid">
                  <label className="field field-wide">
                    <span>Description</span>
                    <textarea
                      onChange={(event) => updateLine(index, 'description', event.target.value)}
                      required
                      rows={2}
                      value={line.description}
                    />
                  </label>
                  <LineField
                    label="Quantity"
                    onChange={(value) => updateLine(index, 'quantity', value)}
                    value={line.quantity}
                  />
                  <LineField
                    label="Unit price"
                    onChange={(value) => updateLine(index, 'unitPrice', value)}
                    value={line.unitPrice}
                  />
                  <LineField
                    label="Discount amount"
                    onChange={(value) => updateLine(index, 'discountAmount', value)}
                    value={line.discountAmount}
                  />
                  <LineField
                    label="Tax category/code"
                    onChange={(value) => updateLine(index, 'taxCategoryCode', value)}
                    value={line.taxCategoryCode ?? ''}
                  />
                  <LineField
                    label="Tax rate (%)"
                    onChange={(value) => updateLine(index, 'taxRate', value)}
                    value={line.taxRate ?? ''}
                  />
                  <LineField
                    label="Line period start"
                    onChange={(value) => updateLine(index, 'periodStart', value)}
                    type="date"
                    value={dateInput(line.periodStart)}
                  />
                  <LineField
                    label="Line period end"
                    onChange={(value) => updateLine(index, 'periodEnd', value)}
                    type="date"
                    value={dateInput(line.periodEnd)}
                  />
                </div>
                {lines.length > 1 && (
                  <button
                    className="button-small danger mt-3"
                    onClick={() => setLines((current) => current.filter((_, i) => i !== index))}
                    type="button"
                  >
                    Remove line
                  </button>
                )}
              </div>
            ))}
            <p className="field-wide muted text-xs">
              Tax category and rate are deliberately blank on creation. Verify the applicable
              treatment; the CRM never assumes 0%.
            </p>
            <div className="field-wide flex gap-3">
              <button className="button-primary" type="submit">
                Save and recalculate
              </button>
              <button className="button-secondary" onClick={() => void validate()} type="button">
                Validate / Preflight
              </button>
              <button className="button-secondary" onClick={() => void markReady()} type="button">
                Ready to Record Official Invoice
              </button>
            </div>
          </form>
        </section>
      )}

      <details className="panel no-print mb-6">
        <summary>Advanced — historical JoFotara submissions (API deferred)</summary>
        <p>Real API submission is disabled. Record official invoices issued outside CRM.</p>
        {history.map((h) => (
          <div key={h.id}>
            <strong>
              Attempt {h.attemptNumber}: {h.outcome} / {h.einvStatus}
            </strong>
            <p>
              {h.connectionNameSnapshot}: {h.message}
            </p>
            <small className="break-all">XML SHA-256: {h.requestXmlHash}</small>
          </div>
        ))}
      </details>
      {admin && invoice.status === 'READY_FOR_FAWTARA' && !invoice.submissionPending && (
        <section className="panel no-print mb-6">
          <h3 className="text-xl font-semibold">تثبيت الفاتورة الرسمية / Officialize Invoice</h3>
          <p className="muted mt-1 text-sm">
            Issue/finalize this invoice outside the CRM, then record the official result here. This
            action makes accepted values authoritative and locks the invoice.
          </p>
          <form className="form-grid mt-5" onSubmit={(event) => void recordResult(event)}>
            <label className="field">
              <span>Official status</span>
              <select defaultValue="SUBMITTED" name="fawtaraStatus">
                <option>SUBMITTED</option>
                <option>ALREADY_SUBMITTED</option>
              </select>
            </label>
            <Field label="Official EINV number" name="invoiceNumber" required />
            <Field label="Official UUID (if available)" name="invoiceUuid" />
            <Field
              label="Acceptance date"
              name="acceptedAt"
              required
              type="datetime-local"
              value={localDateTimeInput()}
            />
            <Field
              label="Official currency"
              name="officialCurrencyCode"
              value={invoice.currencyCode}
              required
            />
            <Field label="Official subtotal" name="officialSubtotal" type="number" required />
            <Field
              label="Official discount total"
              name="officialDiscountTotal"
              type="number"
              required
            />
            <Field label="Official tax total" name="officialTaxTotal" type="number" required />
            <Field
              label="Official grand total"
              name="officialGrandTotal"
              type="number"
              required
            />
            <label className="field field-wide">
              <span>Official EINV_QR payload / Base64</span>
              <textarea name="qrPayload" rows={3} />
            </label>
            <label className="field field-wide">
              <span>Official QR image (PNG/JPEG/WebP, max 40 KB)</span>
              <input
                accept="image/png,image/jpeg,image/webp"
                required
                onChange={(event) => loadQrImage(event.target.files?.[0])}
                type="file"
              />
              {qrImageDataUrl && <small className="text-green-700">QR image loaded.</small>}
            </label>
            <label className="field field-wide">
              <span>Operator note</span>
              <textarea name="note" rows={2} />
            </label>
            <div className="field-wide flex gap-3">
              <button className="button-primary" type="submit">
                تثبيت الفاتورة الرسمية / Officialize Invoice
              </button>
              <button
                className="button-secondary"
                onClick={() =>
                  void run(
                    () => apiRequest(`/invoices/${invoiceId}/return-to-draft`, { method: 'POST' }),
                    'Invoice returned to DRAFT.',
                  )
                }
                type="button"
              >
                Return to Draft
              </button>
            </div>
          </form>
          <div className="mt-6 border-t border-[var(--line)] pt-4">
            <label className="field">
              <span>Record JoFotara rejection/message</span>
              <textarea
                onChange={(event) => setRejectionMessage(event.target.value)}
                rows={2}
                value={rejectionMessage}
              />
            </label>
            <button
              className="button-small danger mt-2"
              disabled={!rejectionMessage.trim()}
              onClick={() =>
                void run(
                  () =>
                    apiRequest(`/invoices/${invoiceId}/record-fawtara-rejection`, {
                      method: 'POST',
                      body: JSON.stringify({ message: rejectionMessage }),
                    }),
                  'JoFotara rejection recorded.',
                )
              }
              type="button"
            >
              Record rejection
            </button>
          </div>
        </section>
      )}

      {admin && invoice.status === 'FAWTARA_REJECTED' && (
        <section className="panel no-print mb-6">
          <h3 className="text-xl font-semibold">JoFotara rejection recorded</h3>
          <p className="mt-2">{invoice.latestFawtaraMessage}</p>
          <button
            className="button-primary mt-4"
            onClick={() =>
              void run(
                () => apiRequest(`/invoices/${invoiceId}/return-to-draft`, { method: 'POST' }),
                'Invoice returned to DRAFT for correction.',
              )
            }
            type="button"
          >
            Return to Draft for correction
          </button>
        </section>
      )}

      {admin && invoice.status === 'FAWTARA_ACCEPTED' && typeof invoice.revision === 'number' && <div className="panel no-print mb-6"><InvoiceQrRecovery invoiceId={invoiceId} revision={invoice.revision} onChanged={load} /></div>}
      {admin && <InvoicePaymentsPanel invoiceId={invoiceId} eligible={invoice.verifiedOfficial === true} />}
      {preflight && <PreflightPanel result={preflight} />}

      <div className="invoice-print-view">
        <InvoiceRenderer invoice={invoice} />
      </div>
    </div>
  );
}

function PreflightPanel({ result }: { result: InvoicePreflightResult }) {
  return (
    <section className="panel no-print mb-6">
      <div className="flex items-center justify-between">
        <h3 className="text-xl font-semibold">Invoice Preflight</h3>
        <strong className={result.valid ? 'text-green-700' : 'text-red-700'}>
          {result.valid ? 'PASS' : 'BLOCKED'}
        </strong>
      </div>
      <p className="muted mt-1 text-xs">{result.scopeNote}</p>
      <div className="mt-4 space-y-2">
        {result.checks.map((check) => (
          <div className="rounded-lg border border-[var(--line)] p-3 text-sm" key={check.code}>
            <strong className={check.status === 'PASS' ? 'text-green-700' : 'text-red-700'}>
              {check.status}
            </strong>{' '}
            · {check.label}
            <p className="muted mt-1">{check.message}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Field({
  label,
  name,
  value,
  type = 'text',
  required = false,
}: {
  label: string;
  name: string;
  value?: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        defaultValue={value}
        name={name}
        required={required}
        step={type === 'number' ? '0.001' : undefined}
        type={type}
      />
    </label>
  );
}

function LineField({
  label,
  value,
  onChange,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        onChange={(event) => onChange(event.target.value)}
        step={type === 'number' ? '0.001' : undefined}
        type={type}
        value={value}
      />
    </label>
  );
}
