'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { apiRequest } from '../lib/api';
import { useControlPanel } from './app-shell';
import { CustomerChannelsManager } from './customer-channels-manager';
import { Modal } from './modal';
import { Notice } from './notice';
import { PageHeading } from './page-heading';

interface BillingEntity {
  id: string;
  code: string;
  name: string;
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
  status: 'ACTIVE' | 'INACTIVE';
  notes: string | null;
  billingEntity: BillingEntity;
  contacts?: Array<{
    id: string;
    role: string;
    name: string | null;
    email: string | null;
    phone: string | null;
    primary: boolean;
    active: boolean;
  }>;
  subscriptions?: Array<{
    id: string;
    subscriptionCode: string;
    name: string;
    renewalDate: string;
    status: string;
    serviceType: { name: string };
  }>;
}

export function CustomerDetail() {
  const params = useParams<{ id: string }>();
  const customerId = params.id;
  const { can } = useControlPanel();
  const canManage = can('ADMIN', 'SALES_DEVELOPMENT');
  const [detail, setDetail] = useState<Customer | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [contactFormOpen, setContactFormOpen] = useState(false);

  const load = useCallback(async () => {
    setDetail(await apiRequest<Customer>(`/customers/${customerId}`));
  }, [customerId]);

  useEffect(() => {
    apiRequest<Customer>(`/customers/${customerId}`)
      .then(setDetail)
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : 'Unable to load customer.'),
      );
  }, [customerId]);

  async function addContact(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? '').trim();
    try {
      await apiRequest(`/customers/${customerId}/contacts`, {
        method: 'POST',
        body: JSON.stringify({
          role: value('role'),
          name: value('name') || undefined,
          email: value('email') || undefined,
          phone: value('phone') || undefined,
          primary: value('primary') === 'true',
        }),
      });
      setSuccess('Customer contact saved and audited.');
      setError('');
      setContactFormOpen(false);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Contact save failed.');
    }
  }

  if (!detail) {
    return (
      <>
        <PageHeading title="Customer" description="Loading…" />
        <Notice message={error} />
      </>
    );
  }

  return (
    <>
      <Link className="table-link" href="/dashboard/customers">
        ← Back to customers
      </Link>
      <PageHeading
        title={detail.companyName}
        description={`${detail.customerCode} · ${detail.billingEntity.name} · ${detail.status}`}
      />
      <Notice message={error} />
      <Notice message={success} tone="success" />
      <section className="panel">
        <h4 className="font-medium">Company details</h4>
        <div className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
          <p>
            <span className="muted">Primary email:</span> {detail.primaryEmail}
          </p>
          <p>
            <span className="muted">Secondary email:</span> {detail.secondaryEmail ?? '—'}
          </p>
          <p>
            <span className="muted">Phone:</span> {detail.phone ?? '—'}
          </p>
          <p>
            <span className="muted">Country:</span> {detail.country ?? '—'}
          </p>
          <p>
            <span className="muted">Tax number:</span> {detail.taxNumber ?? '—'}
          </p>
          <p>
            <span className="muted">Contact name:</span> {detail.contactName ?? '—'}
          </p>
          {detail.address && (
            <p className="sm:col-span-2">
              <span className="muted">Address:</span> {detail.address}
            </p>
          )}
          {detail.notes && (
            <p className="sm:col-span-2">
              <span className="muted">Notes:</span> {detail.notes}
            </p>
          )}
        </div>
        {canManage && (
          <Link
            className="button-small mt-4 inline-block"
            href={`/dashboard/customers?edit=${detail.id}`}
          >
            Edit company details
          </Link>
        )}
      </section>
      <section className="panel mt-6">
        <h4 className="font-medium">Contact channels</h4>
        <CustomerChannelsManager canManage={canManage} customerId={detail.id} />
        <div className="mt-6 flex items-center justify-between gap-3">
          <h4 className="font-medium">Legacy combined contacts</h4>
          {canManage && (
            <button className="button-small" onClick={() => setContactFormOpen(true)} type="button">
              + Add contact
            </button>
          )}
        </div>
        <div className="mt-2 space-y-2">
          {detail.contacts
            ?.filter((contact) => contact.active)
            .map((contact) => (
              <div className="rounded-lg border border-[var(--line)] p-3 text-sm" key={contact.id}>
                <strong>
                  {contact.role}
                  {contact.primary ? ' · Primary' : ''}
                </strong>{' '}
                · {contact.name ?? 'Unnamed'} · {contact.email ?? 'No email'} ·{' '}
                {contact.phone ?? 'No phone'}
              </div>
            ))}
          {!detail.contacts?.filter((contact) => contact.active).length && (
            <p className="muted text-sm">No legacy combined contacts on record.</p>
          )}
        </div>
        {contactFormOpen && (
          <Modal onClose={() => setContactFormOpen(false)} title="Add contact">
            <form className="form-grid" onSubmit={(event) => void addContact(event)}>
              <label className="field">
                <span>Contact role</span>
                <select name="role">
                  <option>PRIMARY</option>
                  <option>BILLING</option>
                  <option>TECHNICAL</option>
                  <option>MANAGEMENT</option>
                  <option>OTHER</option>
                </select>
              </label>
              <Field label="Contact name" name="name" />
              <Field label="Contact email" name="email" type="email" />
              <Field label="Contact phone" name="phone" />
              <label className="field">
                <span>Primary</span>
                <select name="primary">
                  <option value="false">No</option>
                  <option value="true">Yes</option>
                </select>
              </label>
              <div className="field-wide flex gap-3">
                <button className="button-primary" type="submit">
                  Add contact
                </button>
                <button
                  className="button-secondary"
                  onClick={() => setContactFormOpen(false)}
                  type="button"
                >
                  Cancel
                </button>
              </div>
            </form>
          </Modal>
        )}
      </section>
      <section className="panel mt-6">
        <h4 className="font-medium">Subscriptions</h4>
        {canManage && (
          <Link
            className="button-small mt-3 inline-block"
            href={`/dashboard/subscriptions?customerId=${detail.id}`}
          >
            Add another subscription to this customer
          </Link>
        )}
        <div className="mt-3 space-y-2">
          {detail.subscriptions?.length ? (
            detail.subscriptions.map((subscription) => (
              <Link
                className="block rounded-lg border border-[var(--line)] p-3 text-sm transition hover:border-[var(--accent)] hover:bg-[var(--surface)]"
                href={`/dashboard/subscriptions?edit=${subscription.id}`}
                key={subscription.id}
              >
                {subscription.subscriptionCode} · {subscription.serviceType.name} ·{' '}
                {subscription.status} · renews {subscription.renewalDate.slice(0, 10)}
              </Link>
            ))
          ) : (
            <p className="muted text-sm">No subscriptions.</p>
          )}
        </div>
      </section>
    </>
  );
}

function Field({ label, name, type = 'text' }: { label: string; name: string; type?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input name={name} type={type} />
    </label>
  );
}
