'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { apiRequest, type PageResult } from '../lib/api';
import { useControlPanel } from './app-shell';
import { Modal } from './modal';
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
}

const emptyCustomer = {
  customerCode: '',
  companyName: '',
  contactName: '',
  primaryEmail: '',
  secondaryEmail: '',
  phone: '',
  phoneCountryCallingCode: '',
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
  const [formOpen, setFormOpen] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pendingEditId, setPendingEditId] = useState('');

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
    setPendingEditId(new URLSearchParams(window.location.search).get('edit') ?? '');
  }, []);

  useEffect(() => {
    void load().catch((cause: unknown) =>
      setError(cause instanceof Error ? cause.message : 'Load failed.'),
    );
  }, [load]);

  useEffect(() => {
    if (!pendingEditId) return;
    const target = customers?.data.find((item) => item.id === pendingEditId);
    if (target) {
      setEditing(target);
      setFormOpen(true);
      setPendingEditId('');
      return;
    }
    // The customer to edit may not be on the current (filtered/paginated) page — fetch it
    // directly rather than requiring it to already be loaded.
    void apiRequest<Customer>(`/customers/${pendingEditId}`)
      .then((customer) => {
        setEditing(customer);
        setFormOpen(true);
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Load failed.'))
      .finally(() => setPendingEditId(''));
  }, [pendingEditId, customers]);

  function openCreate() {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(customer: Customer) {
    setEditing(customer);
    setFormOpen(true);
  }

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
      phoneCountryCallingCode: value('phoneCountryCallingCode') || undefined,
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
      setFormOpen(false);
      setEditing(null);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Save failed.');
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

  async function deleteCustomer(customer: Customer) {
    if (
      !window.confirm(
        `Permanently delete ${customer.companyName} and all their subscriptions? This cannot be undone.`,
      )
    )
      return;
    try {
      const result = await apiRequest<{ deletedSubscriptions: number }>(
        `/customers/${customer.id}`,
        { method: 'DELETE' },
      );
      setSuccess(`Customer deleted along with ${result.deletedSubscriptions} subscription(s).`);
      if (editing?.id === customer.id) {
        setEditing(null);
        setFormOpen(false);
      }
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Delete failed.');
    }
  }

  function toggleSelected(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAllOnPage() {
    const pageIds = customers?.data.map((customer) => customer.id) ?? [];
    const allSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
    setSelected((current) => {
      const next = new Set(current);
      if (allSelected) {
        for (const id of pageIds) next.delete(id);
      } else {
        for (const id of pageIds) next.add(id);
      }
      return next;
    });
  }

  async function deleteSelected() {
    const ids = [...selected];
    if (!ids.length) return;
    if (
      !window.confirm(
        `Permanently delete ${String(ids.length)} selected customer(s) and all their subscriptions? This cannot be undone.`,
      )
    )
      return;
    setError('');
    setSuccess('');
    let deleted = 0;
    const failures: string[] = [];
    for (const id of ids) {
      const customer = customers?.data.find((entry) => entry.id === id);
      try {
        await apiRequest(`/customers/${id}`, { method: 'DELETE' });
        deleted += 1;
      } catch (cause) {
        failures.push(
          `${customer?.companyName ?? id}: ${cause instanceof Error ? cause.message : 'delete failed'}`,
        );
      }
    }
    setSelected(new Set());
    if (deleted) setSuccess(`Deleted ${String(deleted)} customer(s).`);
    if (failures.length)
      setError(`Could not delete ${String(failures.length)}: ${failures.join('; ')}`);
    await load();
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
      {!formOpen && (
        <>
          <Notice message={error} />
          <Notice message={success} tone="success" />
        </>
      )}
      {canManage && (
        <div className="mb-4">
          <button className="button-primary" onClick={openCreate} type="button">
            + Create customer
          </button>
        </div>
      )}
      {formOpen && (
        <Modal
          onClose={() => setFormOpen(false)}
          title={editing ? `Edit ${editing.companyName}` : 'Create customer'}
        >
          <Notice message={error} />
          <Notice message={success} tone="success" />
          {editing && <p className="muted mb-4 text-xs">Code: {editing.customerCode}</p>}
          <form
            className="form-grid"
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
            <Field label="Phone country calling code" name="phoneCountryCallingCode" value="" />
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
              <button className="button-secondary" onClick={() => setFormOpen(false)} type="button">
                Cancel
              </button>
            </div>
          </form>
        </Modal>
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
          {can('ADMIN') && selected.size > 0 && (
            <button
              className="button-small danger"
              onClick={() => void deleteSelected()}
              type="button"
            >
              Delete {selected.size} selected
            </button>
          )}
        </div>
        <div className="table-wrap mt-4">
          <table>
            <thead>
              <tr>
                {can('ADMIN') && (
                  <th>
                    <input
                      aria-label="Select all customers on this page"
                      checked={
                        (customers?.data.length ?? 0) > 0 &&
                        (customers?.data.every((customer) => selected.has(customer.id)) ?? false)
                      }
                      onChange={() => toggleSelectAllOnPage()}
                      type="checkbox"
                    />
                  </th>
                )}
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
                  {can('ADMIN') && (
                    <td>
                      <input
                        aria-label={`Select ${customer.companyName}`}
                        checked={selected.has(customer.id)}
                        onChange={() => toggleSelected(customer.id)}
                        type="checkbox"
                      />
                    </td>
                  )}
                  <td>
                    <Link className="table-link" href={`/dashboard/customers/${customer.id}`}>
                      {customer.companyName}
                    </Link>
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
                    <Link
                      className="button-small inline-block"
                      href={`/dashboard/customers/${customer.id}`}
                    >
                      View
                    </Link>
                    {canManage && (
                      <button
                        className="button-small"
                        onClick={() => openEdit(customer)}
                        type="button"
                      >
                        Edit
                      </button>
                    )}
                    {can('ADMIN') && customer.status === 'ACTIVE' && (
                      <button
                        className="button-small danger"
                        onClick={() => void deactivate(customer)}
                        type="button"
                      >
                        Deactivate
                      </button>
                    )}
                    {can('ADMIN') && (
                      <button
                        className="button-small danger"
                        onClick={() => void deleteCustomer(customer)}
                        type="button"
                      >
                        Delete
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
