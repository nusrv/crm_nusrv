'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { apiRequest, type PageResult } from '../lib/api';
import { invoiceSourceQuery, eligibleInvoiceSource, invoiceCreationTarget, type InvoiceCreateMode, type InvoiceSourceOption } from '../lib/invoice-create-selection';
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

type SourceRow = InvoiceSourceOption & {
  customerCode?: string;
  subscriptionCode?: string;
  name?: string;
  nameEn?: string | null;
  nameAr?: string | null;
  primaryEmail?: string | null;
  customer?: { nameEn?: string | null; nameAr?: string | null };
};

function sourceLabel(row: SourceRow): string {
  return [row.name || row.nameEn || row.nameAr || row.customer?.nameEn || row.customer?.nameAr,
    row.customer?.nameEn || row.customer?.nameAr, row.subscriptionCode || row.customerCode, row.primaryEmail]
    .filter(Boolean).filter((part, index, parts) => parts.indexOf(part) === index).join(' · ');
}

/** Create a draft only. All identity and financial eligibility is rechecked by the API. */
export function ManualInvoiceDraftForm({
  onCancel,
  onCreated,
  onBusyChange,
}: {
  onCancel: () => void;
  onCreated: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [mode, setMode] = useState<InvoiceCreateMode>('SUBSCRIPTION');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<SourceRow | null>(null);
  const [sourceResult, setSourceResult] = useState<{ query: string; rows: SourceRow[]; error?: string } | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const saving = useRef(false);
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
        const eligible = result.filter((issuer) => issuer.active);
        setIssuers(eligible);
        setIssuerId((existing) => existing || eligible[0]?.id || '');
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Unable to load issuers.');
      });
    return () => { active = false; };
  }, []);

  const query = invoiceSourceQuery(mode, issuerId, search);
  const sourceOptions = sourceResult && sourceResult.query === query
    ? sourceResult.rows.filter(row => eligibleInvoiceSource(mode, issuerId, row)) : [];
  useEffect(() => {
    if (!query) return;
    let active = true;
    const timer = setTimeout(() => {
      void apiRequest<PageResult<SourceRow>>(query).then(result => {
        if (active) setSourceResult({ query, rows: result.data });
      }).catch((cause: unknown) => {
        if (active) setSourceResult({ query, rows: [], error: cause instanceof Error ? cause.message : 'Search failed.' });
      });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [query]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving.current || createdId) return;
    const target = invoiceCreationTarget(mode, issuerId, selected);
    if (!target) { setError('Select a valid active customer or subscription and issuer.'); return; }
    const values = new FormData(event.currentTarget);
    const read = (field: string) => String(values.get(field) ?? '').trim();
    const invoiceDate = read('invoiceDate');
    const periodStart = read('periodStart');
    const periodEnd = read('periodEnd');
    const quantity = read('quantity');
    const unitPrice = read('unitPrice');

    if (mode === 'ONE_TIME' && !read('customerNameEn') && !read('customerNameAr')) {
      setError('Enter the buyer name in English or Arabic.');
      return;
    }
    if (mode !== 'SUBSCRIPTION' && (!periodStart || !periodEnd || periodStart >= periodEnd)) {
      setError('The service period end must be after the start date.');
      return;
    }
    if (mode !== 'SUBSCRIPTION' && (!/^\d{1,11}(?:\.\d{1,3})?$/.test(quantity) ||
        !/^\d{1,11}(?:\.\d{1,3})?$/.test(unitPrice) ||
        Number(quantity) <= 0)) {
      setError('Quantity must be positive. Unit price must be a valid nonnegative three-decimal amount.');
      return;
    }

    // Registered buyer details come from the server's current customer record,
    // never from search labels or fields left over from another mode.
    const request = {
      ...target.identity,
      currencyCode: read('currencyCode').toUpperCase(),
      invoiceDate,
      periodStart,
      periodEnd,
      ...(mode === 'ONE_TIME' ? {
        customerNameEn: read('customerNameEn') || undefined,
        customerNameAr: read('customerNameAr') || undefined,
        customerAddress: read('customerAddress'),
        customerCountry: read('customerCountry'),
        customerPhone: read('customerPhone') || undefined,
        customerTaxNumber: read('customerTaxNumber') || undefined,
      } : {}),
      lines: [{
        description: read('description'),
        quantity,
        unitPrice,
        discountAmount: '0',
        // Tax treatment must be reviewed explicitly in the existing draft
        // editor before READY; absence does not mean a zero percent tax.
      }],
    };

    saving.current = true;
    try {
      setBusy(true);
      onBusyChange(true);
      setError('');
      const created = await apiRequest<{ id: string }>(target.path, {
        method: 'POST',
        ...(mode === 'SUBSCRIPTION' ? {} : { body: JSON.stringify(request) }),
      });
      setCreatedId(created.id);
      onCreated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to create manual invoice draft.');
    } finally {
      setBusy(false);
      onBusyChange(false);
      saving.current = false;
    }
  }

  if (createdId) return (
    <div className="space-y-4">
      <Notice tone="success" message="Invoice draft created. No official invoice or payment has been recorded." />
      <div className="flex flex-wrap gap-2">
        <Link className="button-primary" href={`/dashboard/invoices/${createdId}`}>Open draft for review</Link>
        <button className="button-secondary" type="button" onClick={onCancel}>Close</button>
      </div>
    </div>
  );

  return (
    <form className="form-grid" onSubmit={(event) => void submit(event)}>
      <div className="field-wide">
        <Notice message={error} />
        <p className="muted text-sm">
          Prepare a CRM draft from a saved subscription, a registered customer or a one-time buyer.
          Creating a draft does not issue an official invoice, record a payment or fulfill a renewal.
        </p>
      </div>
      <label className="field field-wide">
        <span>Invoice source</span>
        <select disabled={busy} value={mode} onChange={event => {
          setMode(event.target.value as InvoiceCreateMode); setSelected(null); setSearch(''); setError('');
        }}>
          <option value="SUBSCRIPTION">From active subscription</option>
          <option value="REGISTERED">Free / manual invoice — existing customer</option>
          <option value="ONE_TIME">Free / manual invoice — one-time buyer</option>
        </select>
      </label>
      {mode !== 'SUBSCRIPTION' && <label className="field field-wide">
        <span>Legal invoice issuer</span>
        <select disabled={busy} required value={issuerId} onChange={(event) => {
          setIssuerId(event.target.value); setSelected(null); setSearch('');
        }}>
          {issuers.length === 0 && <option value="">No active issuers available</option>}
          {issuers.map((issuer) => <option key={issuer.id} value={issuer.id}>
            {issuer.legalName || issuer.name}{issuer.issuerType === 'INDIVIDUAL' ? ' (Individual — draft only)' : ''}
          </option>)}
        </select>
      </label>}
      {mode !== 'ONE_TIME' && <div className="field-wide space-y-2">
        <label className="field">
          <span>{mode === 'SUBSCRIPTION' ? 'Search active subscriptions' : 'Search active customers of this issuer'}</span>
          <input disabled={busy || !query} value={search} onChange={event => {
            setSearch(event.target.value); setSelected(null);
          }} placeholder="Search by name or reference…" />
        </label>
        <label className="field">
          <span>{mode === 'SUBSCRIPTION' ? 'Subscription' : 'Existing customer'}</span>
          <select disabled={busy || !query} required value={selected?.id ?? ''} onChange={event => {
            setSelected(sourceOptions.find(row => row.id === event.target.value) ?? null);
          }}>
            <option value="">Choose a result</option>
            {sourceOptions.map(row => <option key={row.id} value={row.id}>{sourceLabel(row)}</option>)}
          </select>
        </label>
        {query && sourceResult?.query !== query && <p className="muted text-sm">Searching…</p>}
        {query && sourceResult?.query === query && <Notice message={sourceResult.error ?? ''} />}
        {query && sourceResult?.query === query && !sourceResult.error && sourceOptions.length === 0 &&
          <p className="muted text-sm">No eligible results. Try another search.</p>}
        {mode === 'REGISTERED' && <p className="muted text-sm">Saved customer details populate the invoice snapshot. You can review missing details in the draft editor.</p>}
        {mode === 'SUBSCRIPTION' && <p className="muted text-sm">The saved service period and price will populate the draft. To invoice a specific accepted renewal, use its renewal case instead.</p>}
      </div>}
      {mode === 'ONE_TIME' && <>
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
      </>}
      {mode !== 'SUBSCRIPTION' && <>
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
        after creation. The legal issuer details are snapshotted on creation. Individual issuer officialization remains unavailable until its template is approved.
      </p>
      </>}
      <div className="field-wide flex flex-wrap gap-2">
        <button className="button-primary" type="submit" disabled={busy || !eligibleInvoiceSource(mode, issuerId, selected)}>
          {busy ? 'Saving draft…' : 'Create draft'}
        </button>
        <button className="button-secondary" type="button" disabled={busy} onClick={onCancel}>Close</button>
      </div>
    </form>
  );
}
