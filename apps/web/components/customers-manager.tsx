'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiRequest, type PageResult } from '../lib/api';
import { useControlPanel } from './app-shell';
import { Notice } from './notice';
import { PageHeading } from './page-heading';

interface BillingEntity {
  id: string;
  code: string;
  name: string;
  active: boolean;
}

interface Customer {
  id: string;
  customerCode: string;
  companyName: string;
  contactName: string | null;
  primaryEmail: string;
  secondaryEmail: string | null;
  phone: string | null;
  address: string | null;
  country: string | null;
  taxNumber: string | null;
  preferredLanguage: string;
  status: 'ACTIVE' | 'INACTIVE';
  notes: string | null;
  billingEntityId: string;
  billingEntity: BillingEntity;
  _count: { subscriptions: number };
  subscriptions?: Array<{
    id: string;
    subscriptionCode: string;
    name: string;
    renewalDate: string;
    serviceType: { name: string };
  }>;
}

const emptyCustomer = {
  customerCode: '',
  companyName: '',
  contactName: '',
  primaryEmail: '',
  secondaryEmail: '',
  phone: '',
  address: '',
  country: '',
  taxNumber: '',
  preferredLanguage: 'en',
  billingEntityId: '',
  status: 'ACTIVE',
  notes: '',
};

export function CustomersManager() {
  const { can } = useControlPanel();
  const canManage = can('ADMIN', 'SALES_DEVELOPMENT');
  const [customers, setCustomers] = useState<PageResult<Customer> | null>(null);
  const [entities, setEntities] = useState<BillingEntity[]>([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [detail, setDetail] = useState<Customer | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const load = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page), pageSize: '20' });
    if (search.trim()) params.set('search', search.trim());
    if (status) params.set('status', status);
    const [customerResult, entityResult] = await Promise.all([
      apiRequest<PageResult<Customer>>(`/customers?${params.toString()}`),
      apiRequest<BillingEntity[]>('/billing-entities'),
    ]);
    setCustomers(customerResult);
    setEntities(entityResult);
  }, [page, search, status]);

  useEffect(() => {
    void load().catch((cause: unknown) =>
      setError(cause instanceof Error ? cause.message : 'Load failed.'),
    );
  }, [load]);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSuccess('');
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? '').trim();
    const body = {
      ...(editing ? {} : { customerCode: value('customerCode') }),
      companyName: value('companyName'),
      contactName: value('contactName') || undefined,
      primaryEmail: value('primaryEmail'),
      secondaryEmail: value('secondaryEmail') || undefined,
      phone: value('phone') || undefined,
      address: value('address') || undefined,
      country: value('country') || undefined,
      taxNumber: value('taxNumber') || undefined,
      preferredLanguage: value('preferredLanguage'),
      billingEntityId: value('billingEntityId'),
      status: value('status'),
      notes: value('notes') || undefined,
    };
    try {
      await apiRequest(`/customers${editing ? `/${editing.id}` : ''}`, {
        method: editing ? 'PATCH' : 'POST',
        body: JSON.stringify(body),
      });
      setSuccess(editing ? 'Customer updated and audited.' : 'Customer created and audited.');
      setEditing(null);
      event.currentTarget.reset();
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Save failed.');
    }
  }

  async function view(customer: Customer) {
    setEditing(customer);
    try {
      setDetail(await apiRequest<Customer>(`/customers/${customer.id}`));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load customer.');
    }
  }

  async function deactivate(customer: Customer) {
    if (!window.confirm(`Deactivate ${customer.companyName}? This does not delete any records.`))
      return;
    try {
      await apiRequest(`/customers/${customer.id}/deactivate`, { method: 'POST' });
      setSuccess('Customer deactivated; operational history was preserved.');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Deactivation failed.');
    }
  }

  const defaults = editing
    ? {
        ...emptyCustomer,
        ...Object.fromEntries(
          Object.entries(editing).map(([key, value]) => [key, value === null ? '' : value]),
        ),
      }
    : emptyCustomer;

  return (
    <>
      <PageHeading
        title="Customers"
        description="Operational customer records. Every customer is assigned to one legal Billing Entity; closing is controlled and non-destructive."
      />
      <Notice message={error} />
      <Notice message={success} tone="success" />
      {canManage && (
        <details className="panel mb-6" open={Boolean(editing)}>
          <summary className="cursor-pointer font-semibold">
            {editing ? `Edit ${editing.customerCode}` : 'Create customer'}
          </summary>
          <form
            className="form-grid mt-5"
            key={editing?.id ?? 'new'}
            onSubmit={(event) => void save(event)}
          >
            {!editing && (
              <Field
                label="Customer code"
                name="customerCode"
                required
                value={defaults.customerCode}
              />
            )}
            <Field
              label="Company name"
              name="companyName"
              required
              value={String(defaults.companyName)}
            />
            <Field label="Contact name" name="contactName" value={String(defaults.contactName)} />
            <Field
              label="Primary email"
              name="primaryEmail"
              required
              type="email"
              value={String(defaults.primaryEmail)}
            />
            <Field
              label="Secondary email"
              name="secondaryEmail"
              type="email"
              value={String(defaults.secondaryEmail)}
            />
            <Field label="Phone" name="phone" value={String(defaults.phone)} />
            <Field label="Country" name="country" value={String(defaults.country)} />
            <Field label="Tax number" name="taxNumber" value={String(defaults.taxNumber)} />
            <label className="field">
              <span>Preferred language</span>
              <select defaultValue={String(defaults.preferredLanguage)} name="preferredLanguage">
                <option value="en">English</option>
                <option value="ar">Arabic</option>
              </select>
            </label>
            <label className="field">
              <span>Billing Entity</span>
              <select
                defaultValue={String(defaults.billingEntityId)}
                name="billingEntityId"
                required
              >
                <option value="">Select…</option>
                {entities
                  .filter((entity) => entity.active)
                  .map((entity) => (
                    <option key={entity.id} value={entity.id}>
                      {entity.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="field">
              <span>Status</span>
              <select defaultValue={String(defaults.status)} name="status">
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </select>
            </label>
            <label className="field field-wide">
              <span>Address</span>
              <textarea defaultValue={String(defaults.address)} name="address" rows={2} />
            </label>
            <label className="field field-wide">
              <span>Notes</span>
              <textarea defaultValue={String(defaults.notes)} name="notes" rows={3} />
            </label>
            <div className="field-wide flex gap-3">
              <button className="button-primary" type="submit">
                {editing ? 'Save changes' : 'Create customer'}
              </button>
              {editing && (
                <button
                  className="button-secondary"
                  onClick={() => {
                    setEditing(null);
                    setDetail(null);
                  }}
                  type="button"
                >
                  Cancel
                </button>
              )}
            </div>
          </form>
        </details>
      )}
      <section className="panel">
        <div className="toolbar">
          <input
            aria-label="Search customers"
            onChange={(event) => {
              setPage(1);
              setSearch(event.target.value);
            }}
            placeholder="Search code, company, email, phone"
            value={search}
          />
          <select
            aria-label="Customer status"
            onChange={(event) => {
              setPage(1);
              setStatus(event.target.value);
            }}
            value={status}
          >
            <option value="">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </select>
        </div>
        <div className="table-wrap mt-4">
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Company</th>
                <th>Email / phone</th>
                <th>Billing Entity</th>
                <th>Subscriptions</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {customers?.data.map((customer) => (
                <tr key={customer.id}>
                  <td>{customer.customerCode}</td>
                  <td>
                    <button
                      className="table-link"
                      onClick={() => void view(customer)}
                      type="button"
                    >
                      {customer.companyName}
                    </button>
                  </td>
                  <td>
                    {customer.primaryEmail}
                    <br />
                    <span className="muted">{customer.phone}</span>
                  </td>
                  <td>{customer.billingEntity.name}</td>
                  <td>{customer._count.subscriptions}</td>
                  <td>
                    <span className="status-pill">{customer.status}</span>
                  </td>
                  <td className="space-x-2">
                    <button
                      className="button-small"
                      onClick={() => void view(customer)}
                      type="button"
                    >
                      View{canManage ? ' / edit' : ''}
                    </button>
                    {can('ADMIN') && customer.status === 'ACTIVE' && (
                      <button
                        className="button-small danger"
                        onClick={() => void deactivate(customer)}
                        type="button"
                      >
                        Deactivate
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination meta={customers?.meta} onPage={setPage} />
      </section>
      {detail && (
        <section className="panel mt-6">
          <h3 className="font-semibold">{detail.companyName} subscriptions</h3>
          <div className="mt-3 space-y-2">
            {detail.subscriptions?.length ? (
              detail.subscriptions.map((subscription) => (
                <div
                  className="rounded-lg border border-[var(--line)] p-3 text-sm"
                  key={subscription.id}
                >
                  {subscription.subscriptionCode} · {subscription.serviceType.name} · renews{' '}
                  {subscription.renewalDate.slice(0, 10)}
                </div>
              ))
            ) : (
              <p className="muted text-sm">No subscriptions.</p>
            )}
          </div>
        </section>
      )}
    </>
  );
}

function Field({
  label,
  name,
  value,
  required,
  type = 'text',
}: {
  label: string;
  name: string;
  value: string;
  required?: boolean;
  type?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input defaultValue={value} name={name} required={required} type={type} />
    </label>
  );
}

function Pagination({
  meta,
  onPage,
}: {
  meta?: PageResult<unknown>['meta'];
  onPage: (page: number) => void;
}) {
  if (!meta) return null;
  return (
    <div className="pagination">
      <button disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)} type="button">
        Previous
      </button>
      <span>
        Page {meta.page} of {Math.max(meta.pageCount, 1)} · {meta.total} records
      </span>
      <button
        disabled={meta.page >= meta.pageCount}
        onClick={() => onPage(meta.page + 1)}
        type="button"
      >
        Next
      </button>
    </div>
  );
}
