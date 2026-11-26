'use client';
import { InvoiceBrandingEditor } from './invoice-branding-editor';
import { JoFotaraConnections } from './jofotara-connections';

import { useEffect, useState } from 'react';
import { apiRequest } from '../lib/api';
import { useControlPanel } from './app-shell';
import { Modal } from './modal';
import { useModalSave } from '../lib/use-modal-save';
import { Notice } from './notice';
import { PageHeading } from './page-heading';

interface BillingEntity {
  id: string;
  code: string;
  customerCodePrefix: string;
  name: string;
  legalName: string;
  issuerType: 'COMPANY' | 'INDIVIDUAL';
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
  const [formOpen, setFormOpen] = useState(false);
  const saveState = useModalSave();
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
      ...(editing ? {} : { code: value('code'), customerCodePrefix: value('customerCodePrefix') }),
      name: value('name'),
      legalName: value('legalName'),
      issuerType: value('issuerType'),
      paymentScope: value('paymentScope'),
      taxNumber: value('taxNumber') || undefined,
      address: value('address') || undefined,
      invoiceEmail: value('invoiceEmail') || undefined,
      active: value('active') === 'true',
      bankDetails: value('bankDetails') || undefined,
    };
    if (!saveState.begin()) return;
    try {
      const saved = await apiRequest<BillingEntity>(`/billing-entities${editing ? `/${editing.id}` : ''}`, {
        method: editing ? 'PATCH' : 'POST',
        body: JSON.stringify(body),
      });
      setEditing(saved);
      saveState.markSaved();
      setMessage('Billing Entity saved and audited.');
      setError('');
      await load().catch(() => setError('Saved successfully, but the list could not be refreshed.'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Save failed.');
    } finally {
      saveState.finish();
    }
  }

  return (
    <>
      <PageHeading
        title="Billing Entities"
        description="Legal billing ownership for customers. Seed identifiers are read-only; business fields remain auditable and editable by administrators."
      />
      {!formOpen && (
        <>
          <Notice message={error} />
          <Notice message={message} tone="success" />
        </>
      )}
      {can('ADMIN') && (
        <div className="mb-4">
          <button
            className="button-primary"
            onClick={() => {
              setEditing(null);
              setError(''); setMessage(''); setFormOpen(true);
            }}
            type="button"
          >
            + Create Billing Entity
          </button>
        </div>
      )}
      {(can('ADMIN') || can('ACCOUNTANT')) &&
        items.map((entity) => (
          <details key={entity.id} className="panel mb-3">
            <summary>Issuer branding — {entity.name}</summary>
            <InvoiceBrandingEditor entityId={entity.id} onSaved={load} />
            <details className="mt-4"><summary>Advanced — JoFotara settings (API deferred)</summary><JoFotaraConnections entityId={entity.id} /></details>
          </details>
        ))}
      {formOpen && (
        <Modal
          closeDisabled={saveState.busy}
          onClose={() => { if (!saveState.busy) setFormOpen(false); }}
          title={editing ? `Edit ${editing.name}` : 'Create Billing Entity'}
        >
          <Notice message={error} />
          <Notice message={message} tone="success" />
          <form
            className="form-grid"
            key={`${editing?.id ?? 'new'}:${saveState.revision}`}
            onSubmit={(event) => void save(event)}
          >
            {!editing && <details className="field-wide" open>
              <summary>Advanced / internal identifiers (required once)</summary>
              <p className="muted text-sm">The system code identifies the issuer internally. The prefix is used to allocate customer codes.</p>
              <div className="form-grid mt-2">
                <Field label="System code" name="code" required />
                <Field label="Customer code prefix (e.g. FF, NS)" name="customerCodePrefix" required />
              </div>
            </details>}
            <label>
              Issuer type
              <select name="issuerType" defaultValue={editing?.issuerType ?? 'COMPANY'}>
                <option value="COMPANY">Company / Organization</option>
                <option value="INDIVIDUAL">Individual / Personal</option>
              </select>
            </label>
            <Field label="Display name" name="name" required value={editing?.name} />
            <Field
              label="Full legal / personal name"
              name="legalName"
              required
              value={editing?.legalName}
            />
            <label className="field">
              <span>Payment scope</span>
              <select defaultValue={editing?.paymentScope ?? 'LOCAL'} name="paymentScope">
                <option value="LOCAL">Local</option>
                <option value="INTERNATIONAL">International</option>
              </select>
            </label>
            <Field label="Tax / National number" name="taxNumber" value={editing?.taxNumber} />
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
            <label className="field field-wide">
              Legacy bank text (used only when no structured bank fields exist; blank keeps saved
              value)
              <textarea name="bankDetails" rows={4} />
            </label>
            <div className="field-wide flex gap-3">
              <button className="button-primary" disabled={saveState.busy} type="submit">
                Save
              </button>
              <button className="button-secondary" disabled={saveState.busy} onClick={() => setFormOpen(false)} type="button">
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      )}
      <section className="panel table-wrap">
        <table>
          <thead>
            <tr>
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
                <td>
                  {item.name}
                  <br />
                  <span className="muted">{item.legalName}</span><details><summary className="text-xs">Advanced identifiers</summary><p>System code: {item.code} · Customer prefix: {item.customerCodePrefix}</p></details>
                </td>
                <td>{item.paymentScope}</td>
                <td>{item._count.customers}</td>
                <td>{item.active ? 'Active' : 'Inactive'}</td>
                <td>
                  {can('ADMIN') && (
                    <button
                      className="button-small"
                      onClick={() => {
                        setEditing(item);
                        setError(''); setMessage(''); setFormOpen(true);
                      }}
                      type="button"
                    >
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
