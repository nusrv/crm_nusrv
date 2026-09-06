'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '../lib/api';
import { Modal } from './modal';
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
  phoneType: string;
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
const phoneTypes = ['MOBILE', 'LANDLINE', 'FAX', 'PHONE'];

export function CustomerChannelsManager({
  customerId,
  canManage,
}: {
  customerId: string;
  canManage: boolean;
}) {
  const [channels, setChannels] = useState<Channels>({ emailAddresses: [], phoneNumbers: [] });
  const [editingEmail, setEditingEmail] = useState<EmailAddress | null>(null);
  const [emailFormOpen, setEmailFormOpen] = useState(false);
  const [editingPhone, setEditingPhone] = useState<PhoneNumber | null>(null);
  const [phoneFormOpen, setPhoneFormOpen] = useState(false);
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

  async function saveEmail(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? '').trim();
    try {
      await apiRequest(
        `/customers/${customerId}/channels/emails${editingEmail ? `/${editingEmail.id}` : ''}`,
        {
          method: editingEmail ? 'PATCH' : 'POST',
          body: JSON.stringify({
            email: value('email'),
            holderName: value('holderName') || undefined,
            role: value('role'),
            label: value('label') || undefined,
            primary: value('primary') === 'true',
          }),
        },
      );
      setMessage(
        editingEmail
          ? 'Email address updated and audited.'
          : 'Email address saved as an individual audited record.',
      );
      setError('');
      setEditingEmail(null);
      setEmailFormOpen(false);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save email address.');
    }
  }

  async function toggleEmailActive(item: EmailAddress) {
    if (
      item.active &&
      !window.confirm(`Deactivate ${item.email}? It stays on record but hides from normal use.`)
    )
      return;
    try {
      await apiRequest(`/customers/${customerId}/channels/emails/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: !item.active }),
      });
      setMessage(item.active ? 'Email address deactivated.' : 'Email address reactivated.');
      setError('');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to update email address.');
    }
  }

  async function savePhone(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? '').trim();
    try {
      await apiRequest(
        `/customers/${customerId}/channels/phones${editingPhone ? `/${editingPhone.id}` : ''}`,
        {
          method: editingPhone ? 'PATCH' : 'POST',
          body: JSON.stringify({
            phoneNumber: value('phoneNumber'),
            countryCallingCode: value('countryCallingCode'),
            phoneType: value('phoneType'),
            holderName: value('holderName'),
            role: value('role'),
            label: value('label') || undefined,
            primary: value('primary') === 'true',
          }),
        },
      );
      setMessage(
        editingPhone
          ? 'Phone number updated and audited.'
          : 'E.164 phone number saved as an individual audited record.',
      );
      setError('');
      setEditingPhone(null);
      setPhoneFormOpen(false);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save phone number.');
    }
  }

  async function togglePhoneActive(item: PhoneNumber) {
    if (
      item.active &&
      !window.confirm(
        `Deactivate ${item.phoneNumber}? It stays on record but hides from normal use.`,
      )
    )
      return;
    try {
      await apiRequest(`/customers/${customerId}/channels/phones/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: !item.active }),
      });
      setMessage(item.active ? 'Phone number deactivated.' : 'Phone number reactivated.');
      setError('');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to update phone number.');
    }
  }

  return (
    <div className="mt-5 space-y-6">
      <Notice message={error} />
      <Notice message={message} tone="success" />
      <section>
        <div className="flex items-center justify-between gap-3">
          <h4 className="font-medium">Email addresses</h4>
          {canManage && (
            <button
              className="button-small"
              onClick={() => {
                setEditingEmail(null);
                setEmailFormOpen(true);
              }}
              type="button"
            >
              + Add email address
            </button>
          )}
        </div>
        <div className="mt-2 space-y-2">
          {channels.emailAddresses.map((item) => (
            <div
              className="rounded-lg border border-[var(--line)] p-3 text-sm"
              key={item.id}
              style={item.active ? undefined : { opacity: 0.55 }}
            >
              <strong>{item.email}</strong>
              {item.primary ? ' · Primary' : ''}
              {item.active ? '' : ' · Inactive'}
              <br />
              <span className="muted">
                {item.holderName ?? 'No holder'} · {item.role}
                {item.label ? ` · ${item.label}` : ''}
              </span>
              {canManage && (
                <div className="mt-2 space-x-2">
                  <button
                    className="button-small"
                    onClick={() => {
                      setEditingEmail(item);
                      setEmailFormOpen(true);
                    }}
                    type="button"
                  >
                    Edit
                  </button>
                  <button
                    className="button-small"
                    onClick={() => void toggleEmailActive(item)}
                    type="button"
                  >
                    {item.active ? 'Deactivate' : 'Reactivate'}
                  </button>
                </div>
              )}
            </div>
          ))}
          {!channels.emailAddresses.length && (
            <p className="muted text-sm">No email addresses on record.</p>
          )}
        </div>
        {emailFormOpen && (
          <Modal
            onClose={() => setEmailFormOpen(false)}
            title={editingEmail ? 'Edit email address' : 'Add email address'}
          >
            <form
              className="form-grid"
              key={editingEmail?.id ?? 'new-email'}
              onSubmit={(event) => void saveEmail(event)}
            >
              <Field
                label="Email address"
                name="email"
                required
                type="email"
                value={editingEmail?.email}
              />
              <Field
                label="Holder / contact person"
                name="holderName"
                value={editingEmail?.holderName ?? undefined}
              />
              <RoleField value={editingEmail?.role} />
              <Field label="Optional label" name="label" value={editingEmail?.label ?? undefined} />
              <PrimaryField value={editingEmail?.primary} />
              <div className="field-wide flex gap-3">
                <Submit label={editingEmail ? 'Save changes' : 'Add email address'} />
                <button
                  className="button-secondary"
                  onClick={() => setEmailFormOpen(false)}
                  type="button"
                >
                  Cancel
                </button>
              </div>
            </form>
          </Modal>
        )}
      </section>
      <section>
        <div className="flex items-center justify-between gap-3">
          <h4 className="font-medium">Phone numbers</h4>
          {canManage && (
            <button
              className="button-small"
              onClick={() => {
                setEditingPhone(null);
                setPhoneFormOpen(true);
              }}
              type="button"
            >
              + Add phone number
            </button>
          )}
        </div>
        <p className="muted mt-1 text-sm">
          Store the full number in E.164 form, such as +962790000000.
        </p>
        <div className="mt-2 space-y-2">
          {channels.phoneNumbers.map((item) => (
            <div
              className="rounded-lg border border-[var(--line)] p-3 text-sm"
              key={item.id}
              style={item.active ? undefined : { opacity: 0.55 }}
            >
              <strong>{item.phoneNumber}</strong> · {item.phoneType}
              {item.primary ? ' · Primary' : ''}
              {item.active ? '' : ' · Inactive'}
              <br />
              <span className="muted">
                Calling code {item.countryCallingCode} · {item.holderName ?? 'No holder'} ·{' '}
                {item.role}
                {item.label ? ` · ${item.label}` : ''}
              </span>
              {canManage && (
                <div className="mt-2 space-x-2">
                  <button
                    className="button-small"
                    onClick={() => {
                      setEditingPhone(item);
                      setPhoneFormOpen(true);
                    }}
                    type="button"
                  >
                    Edit
                  </button>
                  <button
                    className="button-small"
                    onClick={() => void togglePhoneActive(item)}
                    type="button"
                  >
                    {item.active ? 'Deactivate' : 'Reactivate'}
                  </button>
                </div>
              )}
            </div>
          ))}
          {!channels.phoneNumbers.length && (
            <p className="muted text-sm">No phone numbers on record.</p>
          )}
        </div>
        {phoneFormOpen && (
          <Modal
            onClose={() => setPhoneFormOpen(false)}
            title={editingPhone ? 'Edit phone number' : 'Add phone number'}
          >
            <form
              className="form-grid"
              key={editingPhone?.id ?? 'new-phone'}
              onSubmit={(event) => void savePhone(event)}
            >
              <Field
                label="Full E.164 phone number"
                name="phoneNumber"
                placeholder="+962790000000"
                required
                type="tel"
                value={editingPhone?.phoneNumber}
              />
              <Field
                label="Country calling code"
                name="countryCallingCode"
                placeholder="+962"
                required
                value={editingPhone?.countryCallingCode}
              />
              <label className="field">
                <span>Type</span>
                <select defaultValue={editingPhone?.phoneType ?? 'MOBILE'} name="phoneType">
                  {phoneTypes.map((type) => (
                    <option key={type} value={type}>
                      {type === 'PHONE' ? 'PHONE (unspecified)' : type}
                    </option>
                  ))}
                </select>
              </label>
              <Field
                label="Holder / contact person"
                name="holderName"
                required
                value={editingPhone?.holderName ?? undefined}
              />
              <RoleField value={editingPhone?.role} />
              <Field
                label="Optional label"
                name="label"
                placeholder="Mobile, Office, Finance…"
                value={editingPhone?.label ?? undefined}
              />
              <PrimaryField value={editingPhone?.primary} />
              <div className="field-wide flex gap-3">
                <Submit label={editingPhone ? 'Save changes' : 'Add phone number'} />
                <button
                  className="button-secondary"
                  onClick={() => setPhoneFormOpen(false)}
                  type="button"
                >
                  Cancel
                </button>
              </div>
            </form>
          </Modal>
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
  value,
}: {
  label: string;
  name: string;
  required?: boolean;
  type?: string;
  placeholder?: string;
  value?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        defaultValue={value}
        name={name}
        placeholder={placeholder}
        required={required}
        type={type}
      />
    </label>
  );
}
function RoleField({ value }: { value?: string }) {
  return (
    <label className="field">
      <span>Department / type</span>
      <select defaultValue={value ?? 'PRIMARY'} name="role">
        {roles.map((role) => (
          <option key={role}>{role}</option>
        ))}
      </select>
    </label>
  );
}
function PrimaryField({ value }: { value?: boolean }) {
  return (
    <label className="field">
      <span>Primary</span>
      <select defaultValue={String(value ?? false)} name="primary">
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
