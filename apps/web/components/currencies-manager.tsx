'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '../lib/api';
import { useControlPanel } from './app-shell';
import { Notice } from './notice';
import { PageHeading } from './page-heading';

export interface CurrencyOption {
  code: string;
  name: string;
  rateToJod: string | null;
  effectiveDate: string | null;
  active: boolean;
}

export function CurrenciesManager() {
  const { can } = useControlPanel();
  const [currencies, setCurrencies] = useState<CurrencyOption[]>([]);
  const [editing, setEditing] = useState<CurrencyOption | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const load = useCallback(async () => setCurrencies(await apiRequest('/currencies')), []);

  useEffect(() => {
    void load().catch((cause: unknown) =>
      setError(cause instanceof Error ? cause.message : 'Unable to load currencies.'),
    );
  }, [load]);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? '').trim();
    const code = editing?.code ?? value('code').toUpperCase();
    try {
      await apiRequest(`/currencies${editing ? `/${code}` : ''}`, {
        method: editing ? 'PATCH' : 'POST',
        body: JSON.stringify({
          ...(editing ? {} : { code }),
          name: value('name'),
          rateToJod: value('rateToJod'),
          effectiveDate: value('effectiveDate'),
          active: value('active') === 'true',
          changeReason: value('changeReason') || undefined,
        }),
      });
      setEditing(null);
      setMessage('Exchange rate saved and audited.');
      setError('');
      await load();
      event.currentTarget.reset();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save exchange rate.');
    }
  }

  return (
    <>
      <PageHeading
        title="Currencies and exchange rates"
        description="The only rate direction used by the system is 1 unit of the selected currency = X JOD. Subscription contract amounts remain stored in their original currency."
      />
      <Notice message={error} />
      <Notice message={message} tone="success" />
      {can('ADMIN') && (
        <details className="panel mb-6" open={Boolean(editing)}>
          <summary className="cursor-pointer font-semibold">
            {editing ? `Edit ${editing.code}` : 'Add supported currency'}
          </summary>
          <form className="form-grid mt-5" key={editing?.code ?? 'new'} onSubmit={save}>
            <Field
              label="ISO currency code"
              name="code"
              required
              value={editing?.code ?? ''}
              disabled={Boolean(editing)}
            />
            <Field label="Currency name" name="name" required value={editing?.name ?? ''} />
            <Field
              label={`Rate: 1 ${editing?.code ?? '[currency]'} = X JOD`}
              name="rateToJod"
              required
              type="number"
              step="0.000000001"
              value={editing?.rateToJod ?? ''}
            />
            <Field
              label="Rate effective date"
              name="effectiveDate"
              required
              type="date"
              value={editing?.effectiveDate?.slice(0, 10) ?? new Date().toISOString().slice(0, 10)}
            />
            <label className="field">
              <span>Available for subscriptions</span>
              <select defaultValue={String(editing?.active ?? true)} name="active">
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </select>
            </label>
            <Field label="Change reason" name="changeReason" value="" />
            <div className="field-wide flex gap-3">
              <button className="button-primary" type="submit">
                Save currency
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
              <th>Currency</th>
              <th>Defined direction</th>
              <th>Effective date</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {currencies.map((currency) => (
              <tr key={currency.code}>
                <td>
                  <strong>{currency.code}</strong>
                  <br />
                  <span className="muted">{currency.name}</span>
                </td>
                <td>
                  {currency.rateToJod
                    ? `1 ${currency.code} = ${currency.rateToJod} JOD`
                    : 'Rate not configured'}
                </td>
                <td>{currency.effectiveDate?.slice(0, 10) ?? '—'}</td>
                <td>{currency.active ? 'Active' : 'Inactive'}</td>
                <td>
                  {can('ADMIN') && (
                    <button
                      className="button-small"
                      onClick={() => setEditing(currency)}
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
  value,
  required,
  type = 'text',
  step,
  disabled,
}: {
  label: string;
  name: string;
  value: string;
  required?: boolean;
  type?: string;
  step?: string;
  disabled?: boolean;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        defaultValue={value}
        disabled={disabled}
        name={name}
        required={required}
        step={step}
        type={type}
      />
    </label>
  );
}
