'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { apiRequest, type PageResult } from '../lib/api';
import type { InvoiceView } from './invoice-types';
import { Notice } from './notice';
import { Modal } from './modal';
import { useControlPanel } from './app-shell';
import { ManualInvoiceDraftForm } from './manual-invoice-draft-form';
import { PageHeading } from './page-heading';

export function InvoicesManager() {
  const { can } = useControlPanel();
  const [manualOpen, setManualOpen] = useState(false);
  const [result, setResult] = useState<PageResult<InvoiceView> | null>(null);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const params = new URLSearchParams({ pageSize: '100' });
    if (status) params.set('status', status);
    if (search.trim()) params.set('search', search.trim());
    setResult(await apiRequest<PageResult<InvoiceView>>(`/invoices?${params.toString()}`));
  }, [search, status]);

  useEffect(() => {
    const handle = setTimeout(() => {
      void load().catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : 'Unable to load invoices.'),
      );
    }, 250);
    return () => clearTimeout(handle);
  }, [load]);

  return (
    <div>
      <PageHeading
        eyebrow="Financial operations"
        title="Invoices"
        description="Manually reviewed renewal, subscription and independent invoice drafts. A CRM draft is not an official JoFotara invoice."
      />
      <Notice message={error} />
      {can('ADMIN') && (
        <div className="mt-4">
          <button type="button" className="button-primary" onClick={() => setManualOpen(true)}>
            + Create Invoice
          </button>
        </div>
      )}
      {manualOpen && (
        <Modal title="Create Invoice" maxWidth="54rem" onClose={() => setManualOpen(false)}>
          <ManualInvoiceDraftForm
            onCancel={() => setManualOpen(false)}
            onCreated={() => {
              void load().catch((cause: unknown) =>
                setError(cause instanceof Error ? cause.message : 'Unable to refresh invoices.'));
            }}
          />
        </Modal>
      )}
      <div className="filter-bar mt-6">
        <input
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search CRM reference, customer, or official number"
          value={search}
        />
        <select onChange={(event) => setStatus(event.target.value)} value={status}>
          <option value="">All statuses</option>
          <option value="DRAFT">DRAFT</option>
          <option value="READY_FOR_FAWTARA">READY FOR JOFOTARA</option>
          <option value="FAWTARA_ACCEPTED">JOFOTARA ACCEPTED</option>
          <option value="FAWTARA_REJECTED">JOFOTARA REJECTED</option>
          <option value="CANCELLED">CANCELLED</option>
        </select>
      </div>
      <div className="table-wrap mt-5">
        <table>
          <thead>
            <tr>
              <th>Status</th>
              <th>Customer</th>
              <th>Subscription</th>
              <th>CRM reference</th>
              <th>JoFotara number</th>
              <th>Invoice date</th>
              <th>Amount</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {result?.data.map((invoice) => (
              <tr key={invoice.id}>
                <td>
                  <span className="status-badge">{invoice.status}</span>
                </td>
                <td>
                  {invoice.customerCodeSnapshot}
                  <br />
                  <small>{invoice.customerNameEnSnapshot || invoice.customerNameArSnapshot}</small>
                </td>
                <td>
                  {invoice.sourceSubscription ? (
                    <>
                      {invoice.sourceSubscription.name}
                      <br />
                      <small>{invoice.sourceSubscription.subscriptionCode}</small>
                    </>
                  ) : (
                    <span className="muted">{invoice.customerId ? 'Independent / registered customer' : 'Independent / one-time invoice'}</span>
                  )}
                </td>
                <td>{invoice.internalReference}</td>
                <td>{invoice.fawtaraInvoiceNumber || '—'}</td>
                <td>{invoice.invoiceDate.slice(0, 10)}</td>
                <td>
                  {invoice.effectiveGrandTotal} {invoice.effectiveCurrencyCode}
                </td>
                <td>
                  <Link className="button-small" href={`/dashboard/invoices/${invoice.id}`}>
                    Open
                  </Link>
                </td>
              </tr>
            ))}
            {result && result.data.length === 0 && (
              <tr>
                <td colSpan={8}>No invoices found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
