'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiRequest, type PageResult } from '../lib/api';
import { customerDisplayName } from '../lib/customer-name';
import { useControlPanel } from './app-shell';
import { Notice } from './notice';
import { PageHeading } from './page-heading';
import { SubscriptionModal } from './subscription-modal';

interface SubscriptionRow {
  id: string;
  subscriptionCode: string;
  name: string;
  startDate: string;
  renewalDate: string;
  sellingPrice: string;
  currency: string;
  currentSellingPriceJod: string | null;
  supplierCost: string | null;
  status: string;
  customer: { nameEn: string | null; nameAr: string | null };
  serviceType: { name: string };
  servicePackage: { name: string } | null;
  packageNameSnapshot: string | null;
  classificationStatus: string;
  connections: unknown[];
}

export function SubscriptionsManager() {
  const { can } = useControlPanel();
  const canManage = can('ADMIN', 'ACCOUNTANT');
  const canMap = can('ADMIN', 'IT');
  const [result, setResult] = useState<PageResult<SubscriptionRow> | null>(null);
  const [defaultCustomerId, setDefaultCustomerId] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    const params = new URLSearchParams({ page: '1', pageSize: '100' });
    if (search) params.set('search', search);
    if (status) params.set('status', status);
    setResult(await apiRequest<PageResult<SubscriptionRow>>(`/subscriptions?${params.toString()}`));
  }, [search, status]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const customerId = params.get('customerId') ?? '';
    setDefaultCustomerId(customerId);
    if (customerId) {
      setEditingId(null);
      setFormOpen(true);
    }
    const editParam = params.get('edit');
    if (editParam) {
      setEditingId(editParam);
      setFormOpen(true);
    }
  }, []);

  useEffect(() => {
    void load().catch((cause: unknown) =>
      setError(cause instanceof Error ? cause.message : 'Load failed.'),
    );
  }, [load]);

  function openCreate() {
    setEditingId(null);
    setFormOpen(true);
  }

  function openEdit(id: string) {
    setEditingId(id);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingId(null);
  }

  function handleSaved() {
    closeForm();
    setMessage('Subscription saved and audited.');
    void load();
  }

  const date = (value?: string) => (value ? value.slice(0, 10) : '');

  return (
    <>
      <PageHeading
        title="Subscriptions"
        description="Independent billable services with dates and financial fields. Technical dependencies are mapped separately and do not execute actions in Phase 1."
      />
      <Notice message={error} />
      <Notice message={message} tone="success" />
      {canManage && (
        <div className="mb-4">
          <button className="button-primary" onClick={openCreate} type="button">
            + Create subscription
          </button>
        </div>
      )}
      {formOpen && (
        <SubscriptionModal
          defaultCustomerId={defaultCustomerId}
          onClose={closeForm}
          onSaved={handleSaved}
          subscriptionId={editingId}
        />
      )}
      <section className="panel">
        <div className="toolbar">
          <input
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search subscription, name, customer"
            value={search}
          />
          <select onChange={(event) => setStatus(event.target.value)} value={status}>
            <option value="">All statuses</option>
            <option>ACTIVE</option>
            <option>SUSPENDED</option>
            <option>CLOSED</option>
          </select>
        </div>
        <div className="table-wrap mt-4">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Customer</th>
                <th>Type</th>
                <th>Dates</th>
                <th>Price</th>
                <th>Mappings</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {result?.data.map((subscription) => (
                <tr key={subscription.id}>
                  <td>{subscription.name}</td>
                  <td>{customerDisplayName(subscription.customer)}</td>
                  <td>
                    {subscription.serviceType.name}
                    <br />
                    <span className="muted text-xs">
                      {subscription.packageNameSnapshot ??
                        subscription.servicePackage?.name ??
                        'Unclassified'}{' '}
                      · {subscription.classificationStatus}
                    </span>
                  </td>
                  <td>
                    {date(subscription.startDate)} → {date(subscription.renewalDate)}
                  </td>
                  <td>
                    {subscription.sellingPrice} {subscription.currency}
                    <br />
                    <span className="muted">
                      Current equivalent {subscription.currentSellingPriceJod ?? 'rate unavailable'}{' '}
                      JOD
                    </span>
                    <br />
                    <span className="muted">Cost {subscription.supplierCost ?? '—'}</span>
                  </td>
                  <td>{subscription.connections.length}</td>
                  <td>{subscription.status}</td>
                  <td>
                    <button
                      className="button-small"
                      onClick={() => openEdit(subscription.id)}
                      type="button"
                    >
                      View{canManage || canMap ? ' / manage' : ''}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
