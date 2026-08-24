'use client';

import { useEffect, useState } from 'react';
import { apiRequest } from '../lib/api';
import { useControlPanel } from './app-shell';
import { Notice } from './notice';
import { PageHeading } from './page-heading';

interface BillingEntity {
  id: string;
  code: string;
  name: string;
  legalName: string;
  paymentScope: 'LOCAL' | 'INTERNATIONAL';
  taxNumber: string | null;
  address: string | null;
  invoiceEmail: string | null;
  active: boolean;
  _count: { customers: number };
}

export function BillingEntitiesManager() {
  const { can } = useControlPanel();
  const [items, setItems] = useState<BillingEntity[]>([]);
  const [editing, setEditing] = useState<BillingEntity | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function load() {
    setItems(await apiRequest<BillingEntity[]>('/billing-entities'));
  }
  useEffect(() => {
    void load().catch((cause: unknown) =>
      setError(cause instanceof Error ? cause.message : 'Load failed.'),
    );
  }, []);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? '').trim();
    const body = {
      ...(editing ? {} : { code: value('code') }),
      name: value('name'),
      legalName: value('legalName'),
      paymentScope: value('paymentScope'),
      taxNumber: value('taxNumber') || undefined,
      address: value('address') || undefined,
      invoiceEmail: value('invoiceEmail') || undefined,
      active: value('active') === 'true',
    };
    try {
      await apiRequest(`/billing-entities${editing ? `/${editing.id}` : ''}`, {
        method: editing ? 'PATCH' : 'POST',
        body: JSON.stringify(body),
      });
      setEditing(null);
      setMessage('Billing Entity saved and audited.');
      setError('');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Save failed.');
    }
  }

  return (
    <>
      <PageHeading
        title="Billing Entities"
        description="Legal billing ownership for customers. Seed identifiers are read-only; business fields remain auditable and editable by administrators."
      />
      <Notice message={error} />
      <Notice message={message} tone="success" />
      {can('ADMIN') && (
        <details className="panel mb-6" open={Boolean(editing)}>
          <summary className="cursor-pointer font-semibold">
            {editing ? `Edit ${editing.code}` : 'Create Billing Entity'}
          </summary>
          <form
            className="form-grid mt-5"
            key={editing?.id ?? 'new'}
            onSubmit={(event) => void save(event)}
          >
            {!editing && <Field label="System code" name="code" required />}
            <Field label="Display name" name="name" required value={editing?.name} />
            <Field label="Legal name" name="legalName" required value={editing?.legalName} />
            <label className="field">
              <span>Payment scope</span>
              <select defaultValue={editing?.paymentScope ?? 'LOCAL'} name="paymentScope">
                <option value="LOCAL">Local</option>
                <option value="INTERNATIONAL">International</option>
              </select>
            </label>
            <Field label="Tax number" name="taxNumber" value={editing?.taxNumber} />
            <Field
              label="Invoice email"
              name="invoiceEmail"
              type="email"
              value={editing?.invoiceEmail}
            />
            <label className="field">
              <span>Status</span>
              <select defaultValue={String(editing?.active ?? true)} name="active">
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </select>
            </label>
            <label className="field field-wide">
              <span>Address</span>
              <textarea defaultValue={editing?.address ?? ''} name="address" rows={2} />
            </label>
            <div className="field-wide flex gap-3">
              <button className="button-primary" type="submit">
                Save
              </button>
              {editing && (
                <button className="button-secondary" onClick={() => setEditing(null)} type="button">
                  Cancel
                </button>
              )}
            </div>
          </form>
        </details>
      )}
      <section className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Scope</th>
              <th>Customers</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>{item.code}</td>
                <td>
                  {item.name}
                  <br />
                  <span className="muted">{item.legalName}</span>
                </td>
                <td>{item.paymentScope}</td>
                <td>{item._count.customers}</td>
                <td>{item.active ? 'ACTIVE' : 'INACTIVE'}</td>
                <td>
                  {can('ADMIN') && (
                    <button className="button-small" onClick={() => setEditing(item)} type="button">
                      Edit
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

function Field({
  label,
  name,
  required,
  value,
  type = 'text',
}: {
  label: string;
  name: string;
  required?: boolean;
  value?: string | null;
  type?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input defaultValue={value ?? ''} name={name} required={required} type={type} />
    </label>
  );
}
