'use client';
import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '../lib/api';
import { useControlPanel } from './app-shell';
interface Connection {
  id: string;
  displayName: string;
  userLabel: string | null;
  incomeSourceSequence: string;
  enabled: boolean;
  productionSubmissionEnabled: boolean;
  isDefault: boolean;
  clientIdConfigured: boolean;
  secretKeyConfigured: boolean;
  lastUsedAt: string | null;
}
export function JoFotaraConnections({ entityId }: { entityId: string }) {
  const { can } = useControlPanel();
  const [items, setItems] = useState<Connection[]>([]);
  const [editing, setEditing] = useState<Connection | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(
    async () =>
      setItems(
        await apiRequest<Connection[]>(`/billing-entities/${entityId}/jofotara-connections`),
      ),
    [entityId],
  );
  useEffect(() => {
    void apiRequest<Connection[]>(`/billing-entities/${entityId}/jofotara-connections`)
      .then(setItems)
      .catch(() => setError('Unable to load JoFotara connections.'));
  }, [entityId]);
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const value = (n: string) => String(f.get(n) ?? '').trim();
    if (
      f.has('productionSubmissionEnabled') &&
      !window.confirm(
        'Enable REAL production invoice submission for this connection? Saving alone sends nothing.',
      )
    )
      return;
    try {
      await apiRequest(
        `/billing-entities/${entityId}/jofotara-connections${editing ? `/${editing.id}` : ''}`,
        {
          method: editing ? 'PATCH' : 'POST',
          body: JSON.stringify({
            displayName: value('displayName'),
            userLabel: value('userLabel'),
            incomeSourceSequence: value('incomeSourceSequence'),
            clientId: value('clientId') || undefined,
            secretKey: value('secretKey') || undefined,
            enabled: f.has('enabled'),
            isDefault: f.has('isDefault'),
            productionSubmissionEnabled: f.has('productionSubmissionEnabled'),
          }),
        },
      );
      form.reset();
      setEditing(null);
      await load();
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed.');
    }
  }
  return (
    <section className="panel my-4">
      <h2>JoFotara device/link connections</h2>
      <p>
        Each device retains separate credentials and income source. Configured does not mean
        submission enabled. Saving sends nothing.
      </p>
      <p role="alert">{error}</p>
      {items.map((c) => (
        <div key={c.id} className="border-b py-3">
          <strong>{c.displayName}</strong> - {c.enabled ? 'Enabled' : 'Disabled'}{' '}
          {c.isDefault ? ' / Default' : ''}
          <p>
            Client ID: {c.clientIdConfigured ? '********' : 'Not configured'}; Secret Key:{' '}
            {c.secretKeyConfigured ? 'Configured' : 'Not configured'}
          </p>
          <p>
            Production submission: {c.productionSubmissionEnabled ? 'ENABLED' : 'DISABLED'}; Last
            used: {c.lastUsedAt || 'Never used'}
          </p>
          {can('ADMIN') && (
            <button className="button-secondary" onClick={() => setEditing(c)}>
              Edit / replace credentials
            </button>
          )}
        </div>
      ))}
      {can('ADMIN') && (
        <form key={editing?.id || 'new'} onSubmit={save} className="form-grid mt-4">
          <h3>{editing ? 'Edit connection' : 'New connection'}</h3>
          {(['displayName', 'userLabel', 'incomeSourceSequence'] as const).map((n) => (
            <label key={n}>
              {n}
              <input name={n} defaultValue={editing?.[n] ?? ''} required={n !== 'userLabel'} />
            </label>
          ))}
          <label>
            Replace Client ID
            <input name="clientId" type="password" autoComplete="new-password" />
          </label>
          <label>
            Replace Secret Key
            <input name="secretKey" type="password" autoComplete="new-password" />
          </label>
          <label>
            <input type="checkbox" name="enabled" defaultChecked={editing?.enabled ?? true} />
            Enabled
          </label>
          <label>
            <input type="checkbox" name="isDefault" defaultChecked={editing?.isDefault ?? false} />
            Default for this Billing Entity
          </label>
          <label>
            <input
              type="checkbox"
              name="productionSubmissionEnabled"
              defaultChecked={editing?.productionSubmissionEnabled ?? false}
            />
            Production submission enabled
          </label>
          <button className="button-primary">Save connection</button>
          {editing && (
            <button type="button" onClick={() => setEditing(null)}>
              New connection
            </button>
          )}
        </form>
      )}
    </section>
  );
}
