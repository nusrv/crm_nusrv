'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '../lib/api';
import { Notice } from './notice';

interface EmailAddress {
  id: string;
  email: string;
  holderName: string | null;
  role: string;
  label: string | null;
  primary: boolean;
  active: boolean;
}

interface PhoneNumber {
  id: string;
  phoneNumber: string;
  countryCallingCode: string;
  holderName: string | null;
  role: string;
  label: string | null;
  primary: boolean;
  active: boolean;
}

interface Channels {
  emailAddresses: EmailAddress[];
  phoneNumbers: PhoneNumber[];
}

const roles = ['PRIMARY', 'BILLING', 'TECHNICAL', 'MANAGEMENT', 'OTHER'];

export function CustomerChannelsManager({
  customerId,
  canManage,
}: {
  customerId: string;
  canManage: boolean;
}) {
  const [channels, setChannels] = useState<Channels>({ emailAddresses: [], phoneNumbers: [] });
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const load = useCallback(async () => {
    setChannels(await apiRequest<Channels>(`/customers/${customerId}/channels`));
  }, [customerId]);

  useEffect(() => {
    void load().catch((cause: unknown) =>
      setError(cause instanceof Error ? cause.message : 'Unable to load contact methods.'),
    );
  }, [load]);

  async function addEmail(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? '').trim();
    try {
      await apiRequest(`/customers/${customerId}/channels/emails`, {
        method: 'POST',
        body: JSON.stringify({
          email: value('email'),
          holderName: value('holderName') || undefined,
          role: value('role'),
          label: value('label') || undefined,
          primary: value('primary') === 'true',
        }),
      });
      setMessage('Email address saved as an individual audited record.');
      setError('');
      event.currentTarget.reset();
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save email address.');
    }
  }

  async function addPhone(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? '').trim();
    try {
      await apiRequest(`/customers/${customerId}/channels/phones`, {
        method: 'POST',
        body: JSON.stringify({
          phoneNumber: value('phoneNumber'),
          countryCallingCode: value('countryCallingCode'),
          holderName: value('holderName'),
          role: value('role'),
          label: value('label') || undefined,
          primary: value('primary') === 'true',
        }),
      });
      setMessage('E.164 phone number saved as an individual audited record.');
      setError('');
      event.currentTarget.reset();
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save phone number.');
    }
  }

  return (
    <div className="mt-5 space-y-6">
      <Notice message={error} />
      <Notice message={message} tone="success" />
      <section>
        <h4 className="font-medium">Email addresses</h4>
        <div className="mt-2 space-y-2">
          {channels.emailAddresses
            .filter((item) => item.active)
            .map((item) => (
              <div className="rounded-lg border border-[var(--line)] p-3 text-sm" key={item.id}>
                <strong>{item.email}</strong>
                {item.primary ? ' · Primary' : ''}
                <br />
                <span className="muted">
                  {item.holderName ?? 'No holder'} · {item.role}
                  {item.label ? ` · ${item.label}` : ''}
                </span>
              </div>
            ))}
        </div>
        {canManage && (
          <form className="form-grid mt-3" onSubmit={addEmail}>
            <Field label="Email address" name="email" required type="email" />
            <Field label="Holder / contact person" name="holderName" />
            <RoleField />
            <Field label="Optional label" name="label" />
            <PrimaryField />
            <Submit label="Add email address" />
          </form>
        )}
      </section>
      <section>
        <h4 className="font-medium">Phone numbers</h4>
        <p className="muted mt-1 text-sm">
          Store the full number in E.164 form, such as +962790000000.
        </p>
        <div className="mt-2 space-y-2">
          {channels.phoneNumbers
            .filter((item) => item.active)
            .map((item) => (
              <div className="rounded-lg border border-[var(--line)] p-3 text-sm" key={item.id}>
                <strong>{item.phoneNumber}</strong>
                {item.primary ? ' · Primary' : ''}
                <br />
                <span className="muted">
                  Calling code {item.countryCallingCode} · {item.holderName ?? 'No holder'} ·{' '}
                  {item.role}
                  {item.label ? ` · ${item.label}` : ''}
                </span>
              </div>
            ))}
        </div>
        {canManage && (
          <form className="form-grid mt-3" onSubmit={addPhone}>
            <Field
              label="Full E.164 phone number"
              name="phoneNumber"
              placeholder="+962790000000"
              required
              type="tel"
            />
            <Field
              label="Country calling code"
              name="countryCallingCode"
              placeholder="+962"
              required
            />
            <Field label="Holder / contact person" name="holderName" required />
            <RoleField />
            <Field label="Optional label" name="label" placeholder="Mobile, Office, Finance…" />
            <PrimaryField />
            <Submit label="Add phone number" />
          </form>
        )}
      </section>
    </div>
  );
}

function Field({
  label,
  name,
  required,
  type = 'text',
  placeholder,
}: {
  label: string;
  name: string;
  required?: boolean;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input name={name} placeholder={placeholder} required={required} type={type} />
    </label>
  );
}
function RoleField() {
  return (
    <label className="field">
      <span>Department / type</span>
      <select name="role">
        {roles.map((role) => (
          <option key={role}>{role}</option>
        ))}
      </select>
    </label>
  );
}
function PrimaryField() {
  return (
    <label className="field">
      <span>Primary</span>
      <select name="primary">
        <option value="false">No</option>
        <option value="true">Yes</option>
      </select>
    </label>
  );
}
function Submit({ label }: { label: string }) {
  return (
    <div className="field-wide">
      <button className="button-small" type="submit">
        {label}
      </button>
    </div>
  );
}
