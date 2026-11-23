'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { apiRequest } from '../lib/api';
import { Notice } from './notice';

type Issuer = {
  id: string;
  code: string;
  name: string;
  legalName: string;
  issuerType: 'COMPANY' | 'INDIVIDUAL';
  active: boolean;
};

function localIsoDate(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

/** Independent one-time invoice draft, not an official invoice or renewal fulfillment. */
export function ManualInvoiceDraftForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: () => void;
}) {
  const router = useRouter();
  const [issuers, setIssuers] = useState<Issuer[]>([]);
  const [issuerId, setIssuerId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const today = useMemo(() => {
    const date = new Date();
    const tomorrow = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
    return { date: localIsoDate(date), next: localIsoDate(tomorrow) };
  }, []);

  useEffect(() => {
    let active = true;
    void apiRequest<Issuer[]>('/billing-entities')
      .then((result) => {
        if (!active) return;
        const eligible = result.filter((issuer) => issuer.active && issuer.issuerType === 'COMPANY');
        setIssuers(eligible);
        setIssuerId((existing) => existing || eligible[0]?.id || '');
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Unable to load issuers.');
      });
    return () => { active = false; };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !issuerId) return;
    const values = new FormData(event.currentTarget);
    const read = (field: string) => String(values.get(field) ?? '').trim();
    const invoiceDate = read('invoiceDate');
    const periodStart = read('periodStart');
    const periodEnd = read('periodEnd');
    const quantity = read('quantity');
    const unitPrice = read('unitPrice');

    if (!read('customerNameEn') && !read('customerNameAr')) {
      setError('Enter the buyer name in English or Arabic.');
      return;
    }
    if (!periodStart || !periodEnd || periodStart >= periodEnd) {
      setError('The service period end must be after the start date.');
      return;
    }
    if (!/^\\d{1,11}(?:\\.\\d{1,3})?$/.test(quantity) ||
        !/^\\d{1,11}(?:\\.\\d{1,3})?$/.test(unitPrice) ||
        Number(quantity) <= 0) {
      setError('Quantity must be positive. Unit price must be a valid nonnegative three-decimal amount.');
      return;
    }

    // This flow deliberately does not select a Subscription or a Renewal Case.
    // It therefore cannot accidentally fulfill a renewal or attach an historical invoice.
    const request = {
      billingEntityId: issuerId,
      currencyCode: read('currencyCode').toUpperCase(),
      invoiceDate,
      periodStart,
      periodEnd,
      customerNameEn: read('customerNameEn') || undefined,
      customerNameAr: read('customerNameAr') || undefined,
      customerAddress: read('customerAddress'),
      customerCountry: read('customerCountry'),
      customerPhone: read('customerPhone') || undefined,
      customerTaxNumber: read('customerTaxNumber') || undefined,
      lines: [{
        description: read('description'),
        quantity,
        unitPrice,
        discountAmount: '0',
        // Tax treatment must be reviewed explicitly in the existing draft
        // editor before READY; absence does not mean a zero percent tax.
      }],
    };

    try {
      setBusy(true);
      setError('');
      const created = await apiRequest<{ id: string }>('/invoices/manual-draft', {
        method: 'POST',
        body: JSON.stringify(request),
      });
      onCreated();
      router.push(`/dashboard/invoices/${created.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to create manual invoice draft.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form-grid" onSubmit={(event) => void submit(event)}>
      <div className="field-wide">
        <Notice message={error} />
        <p className="muted text-sm">
          Create an independent, one-time CRM draft. This does not issue an official JoFotara
          invoice, record a payment, or renew a subscription. Verify tax and the issuer snapshot
          in the invoice editor before marking it ready.
        </p>
      </div>
      <label className="field field-wide">
        <span>Legal invoice issuer (company)</span>
        <select required value={issuerId} onChange={(event) => setIssuerId(event.target.value)}>
          {issuers.length === 0 && <option value="">No active company issuers available</option>}
          {issuers.map((issuer) => <option key={issuer.id} value={issuer.id}>
            {issuer.code} · {issuer.legalName || issuer.name}
          </option>)}
        </select>
      </label>
      <label className="field">
        <span>Buyer name (English)</span>
        <input name="customerNameEn" maxLength={191} placeholder="One-time buyer" />
      </label>
      <label className="field">
        <span>Buyer name (Arabic)</span>
        <input name="customerNameAr" maxLength={191} dir="auto" />
      </label>
      <label className="field">
        <span>Buyer country</span>
        <input name="customerCountry" maxLength={191} required defaultValue="Jordan" />
      </label>
      <label className="field">
        <span>Buyer address</span>
        <input name="customerAddress" maxLength={4000} required />
      </label>
      <label className="field">
        <span>Buyer phone (optional)</span>
        <input name="customerPhone" maxLength={80} />
      </label>
      <label className="field">
        <span>Buyer tax number (optional)</span>
        <input name="customerTaxNumber" maxLength={191} />
      </label>
      <label className="field">
        <span>Currency (ISO 4217)</span>
        <input name="currencyCode" defaultValue="JOD" maxLength={3} required pattern="[A-Za-z]{3}" />
      </label>
      <label className="field">
        <span>Invoice date</span>
        <input type="date" name="invoiceDate" defaultValue={today.date} required />
      </label>
      <label className="field">
        <span>Service period start</span>
        <input type="date" name="periodStart" defaultValue={today.date} required />
      </label>
      <label className="field">
        <span>Service period end</span>
        <input type="date" name="periodEnd" defaultValue={today.next} required />
      </label>
      <label className="field field-wide">
        <span>Invoice line description</span>
        <textarea name="description" rows={3} required maxLength={5000} />
      </label>
      <label className="field">
        <span>Quantity</span>
        <input name="quantity" defaultValue="1.000" inputMode="decimal" required />
      </label>
      <label className="field">
        <span>Unit price</span>
        <input name="unitPrice" defaultValue="0.000" inputMode="decimal" required />
      </label>
      <p className="field-wide muted text-sm">
        Additional invoice lines and tax categorization can be entered in the draft editor
        after creation. The company issuer details are snapshotted on creation.
      </p>
      <div className="field-wide flex flex-wrap gap-2">
        <button className="button-primary" type="submit" disabled={busy || !issuerId}>
          {busy ? 'Saving draft…' : 'Create manual draft'}
        </button>
        <button className="button-secondary" type="button" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
