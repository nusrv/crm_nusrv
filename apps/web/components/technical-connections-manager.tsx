'use client';

import { useEffect, useState } from 'react';
import { apiRequest } from '../lib/api';
import { useControlPanel } from './app-shell';
import { Notice } from './notice';
import { PageHeading } from './page-heading';

interface TechnicalConnection {
  id: string;
  code: string;
  name: string;
  type: string;
  endpoint: string | null;
  environment: string;
  enabled: boolean;
  capabilities: Record<string, unknown> | null;
  credentials: string | null;
  credentialsConfigured: boolean;
  lastHealthStatus: string;
  lastHealthCheckedAt: string | null;
  _count: { subscriptions: number };
}

export function TechnicalConnectionsManager() {
  const { can } = useControlPanel();
  const canManage = can('ADMIN', 'IT');
  const [items, setItems] = useState<TechnicalConnection[]>([]);
  const [editing, setEditing] = useState<TechnicalConnection | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  async function load() {
    setItems(await apiRequest<TechnicalConnection[]>('/technical-connections'));
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
    try {
      const capabilitiesText = value('capabilities');
      const credentialsText = value('credentials');
      const body = {
        ...(editing ? {} : { code: value('code'), type: value('type') }),
        name: value('name'),
        endpoint: value('endpoint') || undefined,
        environment: value('environment'),
        enabled: value('enabled') === 'true',
        capabilities: capabilitiesText
          ? (JSON.parse(capabilitiesText) as Record<string, unknown>)
          : undefined,
        credentials: credentialsText
          ? (JSON.parse(credentialsText) as Record<string, unknown>)
          : undefined,
        ...(editing ? { clearCredentials: form.get('clearCredentials') === 'on' } : {}),
      };
      await apiRequest(`/technical-connections${editing ? `/${editing.id}` : ''}`, {
        method: editing ? 'PATCH' : 'POST',
        body: JSON.stringify(body),
      });
      setEditing(null);
      setMessage(
        'Technical Connection saved. Credentials were encrypted and the change was audited.',
      );
      setError('');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Save failed.');
    }
  }

  return (
    <>
      <PageHeading
        title="Technical Connections"
        description="Connection inventory and capabilities only. Credentials are encrypted, always masked, and no external actions are available in Phase 1."
      />
      <Notice message={error} />
      <Notice message={message} tone="success" />
      {canManage && (
        <details className="panel mb-6" open={Boolean(editing)}>
          <summary className="cursor-pointer font-semibold">
            {editing ? `Edit ${editing.code}` : 'Create Technical Connection'}
          </summary>
          <form
            className="form-grid mt-5"
            key={editing?.id ?? 'new'}
            onSubmit={(event) => void save(event)}
          >
            {!editing && (
              <label className="field">
                <span>Code</span>
                <input name="code" placeholder="PLESK-01" required />
              </label>
            )}
            <label className="field">
              <span>Name</span>
              <input defaultValue={editing?.name ?? ''} name="name" required />
            </label>
            {!editing && (
              <label className="field">
                <span>Type</span>
                <select name="type">
                  <option value="PLESK">Plesk</option>
                  <option value="SMARTERMAIL">SmarterMail</option>
                  <option value="MANUAL">Manual</option>
                  <option value="FUTURE_API">Future API</option>
                </select>
              </label>
            )}
            <label className="field">
              <span>Endpoint / host</span>
              <input defaultValue={editing?.endpoint ?? ''} name="endpoint" />
            </label>
            <label className="field">
              <span>Environment</span>
              <select defaultValue={editing?.environment ?? 'SANDBOX'} name="environment">
                <option value="SANDBOX">Sandbox</option>
                <option value="PRODUCTION">Production (configuration only)</option>
              </select>
            </label>
            <label className="field">
              <span>Status</span>
              <select defaultValue={String(editing?.enabled ?? true)} name="enabled">
                <option value="true">Enabled</option>
                <option value="false">Disabled</option>
              </select>
            </label>
            <label className="field field-wide">
              <span>Capabilities (JSON)</span>
              <textarea
                defaultValue={
                  editing?.capabilities ? JSON.stringify(editing.capabilities, null, 2) : '{}'
                }
                name="capabilities"
                rows={4}
              />
            </label>
            <label className="field field-wide">
              <span>
                {editing?.credentialsConfigured
                  ? 'Replace credentials (current value is masked)'
                  : 'Credentials JSON'}
              </span>
              <textarea
                autoComplete="new-password"
                name="credentials"
                placeholder='{"username":"…","password":"…"}'
                rows={4}
              />
            </label>
            {editing?.credentialsConfigured && (
              <label className="checkbox field-wide">
                <input name="clearCredentials" type="checkbox" /> Clear stored credentials
              </label>
            )}
            <div className="field-wide flex gap-3">
              <button className="button-primary" type="submit">
                Save secure configuration
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
              <th>Code / name</th>
              <th>Type</th>
              <th>Endpoint</th>
              <th>Environment</th>
              <th>Credentials</th>
              <th>Mappings</th>
              <th>Health</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>
                  {item.code}
                  <br />
                  <span className="muted">{item.name}</span>
                </td>
                <td>{item.type}</td>
                <td>{item.endpoint ?? '—'}</td>
                <td>
                  {item.environment}
                  <br />
                  <span className="muted">{item.enabled ? 'Enabled' : 'Disabled'}</span>
                </td>
                <td>{item.credentials ?? 'Not configured'}</td>
                <td>{item._count.subscriptions}</td>
                <td>
                  {item.lastHealthStatus}
                  <br />
                  <span className="muted">
                    {item.lastHealthCheckedAt
                      ? new Date(item.lastHealthCheckedAt).toLocaleString()
                      : 'Never checked'}
                  </span>
                </td>
                <td>
                  {canManage && (
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
