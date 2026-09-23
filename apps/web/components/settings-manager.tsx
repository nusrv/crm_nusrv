'use client';

import { Fragment, useEffect, useState } from 'react';
import { apiRequest } from '../lib/api';
import { useControlPanel } from './app-shell';
import { Modal } from './modal';
import { Notice } from './notice';
import { PageHeading } from './page-heading';

interface MailSettingsRow {
  id: string;
  scope: string;
  billingEntityId: string | null;
  label: string;
  environment: string;
  enabled: boolean;
  mailboxAddress: string;
  fromName: string;
  fromAddress: string;
  authMode: 'BASIC' | 'MICROSOFT_OAUTH2' | null;
  credentialsConfigured: boolean;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  inboundSyncEnabled: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  outboundSendEnabled: boolean;
  outboundSendCutoverAt: string | null;
  lastHealthStatus: string;
  lastHealthCheckedAt: string | null;
  lastSyncedAt: string | null;
}

interface AiSettingsView {
  enabled: boolean;
  provider: string;
  model: string | null;
  apiKeyConfigured: boolean;
  confidenceThreshold: number | null;
  autoRouteAccept: boolean;
  autoRouteAcceptCutoverAt: string | null;
  updatedAt: string | null;
}

interface HealthEntry {
  status: string;
  checkedAt: string;
  message: string;
}

/** Mirrors the API's MailChannelStatus — see integration-health.service.ts. `effective` is the
 * only field that answers "would a real send/sync actually happen right now"; the other three name
 * exactly which layer is blocking it when `effective` is not READY. */
interface MailChannelStatus {
  configured: boolean;
  operationallyEnabled: boolean;
  deploymentAdapter: 'REAL' | 'MOCK';
  effective: 'READY' | 'NOT_CONFIGURED' | 'DISABLED' | 'BLOCKED_BY_DEPLOYMENT';
}

interface HealthOverview {
  mail: Array<{
    mailConfigurationId: string;
    scope: string;
    label: string;
    smtp: HealthEntry | null;
    imap: HealthEntry | null;
    smtpStatus: MailChannelStatus;
    imapStatus: MailChannelStatus;
  }>;
  ai: HealthEntry | null;
}

const EFFECTIVE_STATUS_LABEL: Record<MailChannelStatus['effective'], string> = {
  READY: 'Ready',
  NOT_CONFIGURED: 'Not configured',
  DISABLED: 'Disabled in Settings',
  BLOCKED_BY_DEPLOYMENT: 'BLOCKED — deployment has no real adapter',
};

function EffectiveStatusCell({ status }: { status: MailChannelStatus }) {
  return (
    <span>
      {EFFECTIVE_STATUS_LABEL[status.effective]}
      <br />
      <span className="muted">
        Configured: {status.configured ? 'Yes' : 'No'} · Enabled: {status.operationallyEnabled ? 'Yes' : 'No'} · Deployment
        adapter: {status.deploymentAdapter === 'REAL' ? 'Real' : 'Mock'}
      </span>
    </span>
  );
}

type TabKey = 'mail' | 'ai' | 'health';

export function SettingsManager() {
  const { can } = useControlPanel();
  const canManage = can('ADMIN');
  const [tab, setTab] = useState<TabKey>('mail');

  return (
    <>
      <PageHeading
        title="Settings"
        description="Administer Mail/Outlook and AI operational configuration directly from the CRM — no SSH, Plesk, or restart required for routine changes."
      />
      <div className="mb-6 flex gap-2 border-b border-[var(--line)]">
        {(
          [
            ['mail', 'Email & Mailboxes'],
            ['ai', 'AI'],
            ['health', 'Integration Health'],
          ] as const
        ).map(([key, label]) => (
          <button
            className={`px-4 py-2 text-sm font-medium ${tab === key ? 'border-b-2 border-[var(--accent)] text-[var(--accent)]' : 'text-[var(--muted)]'}`}
            key={key}
            onClick={() => setTab(key)}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'mail' && <MailSettingsSection canManage={canManage} />}
      {tab === 'ai' && <AiSettingsSection canManage={canManage} />}
      {tab === 'health' && <IntegrationHealthSection />}
    </>
  );
}

const M365_IMAP = { host: 'outlook.office365.com', port: 993, secure: true };
const M365_SMTP = { host: 'smtp.office365.com', port: 587, secure: false };

function MailSettingsSection({ canManage }: { canManage: boolean }) {
  const [items, setItems] = useState<MailSettingsRow[]>([]);
  const [editing, setEditing] = useState<MailSettingsRow | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [scopeType, setScopeType] = useState<'GLOBAL' | 'BILLING_ENTITY'>('GLOBAL');
  const [authMode, setAuthMode] = useState<'BASIC' | 'MICROSOFT_OAUTH2'>('BASIC');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [testResults, setTestResults] = useState<Record<string, string>>({});

  async function load() {
    setItems(await apiRequest<MailSettingsRow[]>('/settings/mail'));
  }
  useEffect(() => {
    void load().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Load failed.'));
  }, []);

  function openCreate() {
    setEditing(null);
    setScopeType('GLOBAL');
    setAuthMode('BASIC');
    setFormOpen(true);
  }
  function openEdit(item: MailSettingsRow) {
    setEditing(item);
    setScopeType(item.scope === 'GLOBAL' ? 'GLOBAL' : 'BILLING_ENTITY');
    setAuthMode(item.authMode ?? 'BASIC');
    setFormOpen(true);
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? '').trim();
    try {
      const scope = scopeType === 'GLOBAL' ? 'GLOBAL' : `BILLING_ENTITY:${value('billingEntityId')}`;
      const body: Record<string, unknown> = {
        ...(editing ? {} : { scope }),
        label: value('label'),
        environment: value('environment'),
        enabled: form.get('enabled') === 'on',
        mailboxAddress: value('mailboxAddress'),
        fromName: value('fromName'),
        fromAddress: value('fromAddress') || undefined,
        authMode,
        imapHost: value('imapHost'),
        imapPort: Number(value('imapPort')),
        imapSecure: form.get('imapSecure') === 'on',
        inboundSyncEnabled: form.get('inboundSyncEnabled') === 'on',
        smtpHost: value('smtpHost'),
        smtpPort: Number(value('smtpPort')),
        smtpSecure: form.get('smtpSecure') === 'on',
        outboundSendEnabled: form.get('outboundSendEnabled') === 'on',
        outboundSendCutoverAt: value('outboundSendCutoverAt') ? new Date(value('outboundSendCutoverAt')).toISOString() : undefined,
      };
      if (authMode === 'BASIC') {
        if (value('password')) body.password = value('password');
      } else {
        if (value('tenantId')) body.tenantId = value('tenantId');
        if (value('clientId')) body.clientId = value('clientId');
        if (value('clientSecret')) body.clientSecret = value('clientSecret');
      }
      if (editing && form.get('clearCredentials') === 'on') body.clearCredentials = true;

      await apiRequest(`/settings/mail${editing ? `/${editing.id}` : ''}`, {
        method: editing ? 'PATCH' : 'POST',
        body: JSON.stringify(body),
      });
      setFormOpen(false);
      setEditing(null);
      setError('');
      setMessage('Mail configuration saved. Credentials (if provided) were encrypted and the change was audited.');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Save failed.');
    }
  }

  async function runTest(id: string, kind: 'imap' | 'smtp') {
    try {
      const result = await apiRequest<{ success: boolean; message: string }>(`/settings/mail/${id}/test-${kind}`, { method: 'POST' });
      setTestResults((prev) => ({ ...prev, [`${id}-${kind}`]: result.success ? 'Connected' : `Failed: ${result.message}` }));
      await load();
    } catch (cause) {
      setTestResults((prev) => ({ ...prev, [`${id}-${kind}`]: cause instanceof Error ? cause.message : 'Test failed.' }));
    }
  }

  function fillDefaults(formEl: HTMLFormElement | null, protocol: 'imap' | 'smtp') {
    if (!formEl) return;
    const defaults = protocol === 'imap' ? M365_IMAP : M365_SMTP;
    (formEl.elements.namedItem(`${protocol}Host`) as HTMLInputElement).value = defaults.host;
    (formEl.elements.namedItem(`${protocol}Port`) as HTMLInputElement).value = String(defaults.port);
    (formEl.elements.namedItem(`${protocol}Secure`) as HTMLInputElement).checked = defaults.secure;
  }

  return (
    <>
      {!formOpen && (
        <>
          <Notice message={error} />
          <Notice message={message} tone="success" />
        </>
      )}
      {canManage && (
        <div className="mb-4">
          <button className="button-primary" onClick={openCreate} type="button">
            + Create Mail Configuration
          </button>
        </div>
      )}
      {formOpen && (
        <Modal maxWidth="42rem" onClose={() => setFormOpen(false)} title={editing ? `Edit ${editing.label}` : 'Create Mail Configuration'}>
          <Notice message={error} />
          <form className="form-grid" id="mail-settings-form" key={editing?.id ?? 'new'} onSubmit={(e) => void save(e)}>
            <h4 className="field-wide mt-2 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">General</h4>
            {!editing && (
              <label className="field">
                <span>Scope</span>
                <select onChange={(e) => setScopeType(e.target.value as 'GLOBAL' | 'BILLING_ENTITY')} value={scopeType}>
                  <option value="GLOBAL">Global</option>
                  <option value="BILLING_ENTITY">Billing Entity</option>
                </select>
              </label>
            )}
            {!editing && scopeType === 'BILLING_ENTITY' && (
              <label className="field">
                <span>Billing Entity ID</span>
                <input name="billingEntityId" required />
              </label>
            )}
            <label className="field">
              <span>Label</span>
              <input defaultValue={editing?.label ?? ''} name="label" required />
            </label>
            <label className="field">
              <span>Environment</span>
              <select defaultValue={editing?.environment ?? 'SANDBOX'} name="environment">
                <option value="SANDBOX">Sandbox</option>
                <option value="PRODUCTION">Production</option>
              </select>
            </label>
            <label className="checkbox field">
              <input defaultChecked={editing?.enabled ?? true} name="enabled" type="checkbox" /> Enabled
            </label>
            <label className="field">
              <span>Mailbox address</span>
              <input defaultValue={editing?.mailboxAddress ?? ''} name="mailboxAddress" required type="email" />
            </label>
            <label className="field">
              <span>From Name</span>
              <input defaultValue={editing?.fromName ?? ''} name="fromName" required />
            </label>
            <label className="field">
              <span>From Address (optional — defaults to mailbox address)</span>
              <input defaultValue={editing?.fromAddress ?? ''} name="fromAddress" type="email" />
            </label>

            <h4 className="field-wide mt-2 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">Authentication</h4>
            <label className="field">
              <span>Authentication type</span>
              <select onChange={(e) => setAuthMode(e.target.value as 'BASIC' | 'MICROSOFT_OAUTH2')} value={authMode}>
                <option value="BASIC">Basic (username/password)</option>
                <option value="MICROSOFT_OAUTH2">Microsoft 365 OAuth2</option>
              </select>
            </label>
            {editing && <p className="field text-sm text-[var(--muted)]">Current: {editing.credentialsConfigured ? 'Configured' : 'Not configured'}</p>}
            {authMode === 'BASIC' ? (
              <label className="field field-wide">
                <span>{editing?.credentialsConfigured ? 'Replace password (leave blank to keep the current one)' : 'Password'}</span>
                <input autoComplete="new-password" name="password" type="password" />
              </label>
            ) : (
              <>
                <label className="field">
                  <span>Tenant ID</span>
                  <input name="tenantId" placeholder={editing?.credentialsConfigured ? 'Leave blank to keep current' : ''} />
                </label>
                <label className="field">
                  <span>Client ID</span>
                  <input name="clientId" placeholder={editing?.credentialsConfigured ? 'Leave blank to keep current' : ''} />
                </label>
                <label className="field field-wide">
                  <span>Client Secret {editing?.credentialsConfigured ? '(Configured — leave blank to keep current)' : ''}</span>
                  <input autoComplete="new-password" name="clientSecret" type="password" />
                </label>
              </>
            )}
            {editing?.credentialsConfigured && (
              <label className="checkbox field-wide">
                <input name="clearCredentials" type="checkbox" /> Clear stored credentials
              </label>
            )}

            <h4 className="field-wide mt-2 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">IMAP (inbound)</h4>
            <label className="field">
              <span>Host</span>
              <input defaultValue={editing?.imapHost ?? ''} name="imapHost" required />
            </label>
            <label className="field">
              <span>Port</span>
              <input defaultValue={editing?.imapPort ?? 993} name="imapPort" required type="number" />
            </label>
            <label className="checkbox field">
              <input defaultChecked={editing?.imapSecure ?? true} name="imapSecure" type="checkbox" /> Secure (TLS)
            </label>
            <button
              className="button-secondary field"
              onClick={(e) => fillDefaults(e.currentTarget.closest('form'), 'imap')}
              type="button"
            >
              Use Microsoft 365 defaults
            </button>
            <label className="checkbox field-wide">
              <input defaultChecked={editing?.inboundSyncEnabled ?? false} name="inboundSyncEnabled" type="checkbox" /> Inbound sync enabled
            </label>

            <h4 className="field-wide mt-2 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">SMTP (outbound)</h4>
            <label className="field">
              <span>Host</span>
              <input defaultValue={editing?.smtpHost ?? ''} name="smtpHost" required />
            </label>
            <label className="field">
              <span>Port</span>
              <input defaultValue={editing?.smtpPort ?? 587} name="smtpPort" required type="number" />
            </label>
            <label className="checkbox field">
              <input defaultChecked={editing?.smtpSecure ?? true} name="smtpSecure" type="checkbox" /> Secure (implicit TLS)
            </label>
            <button
              className="button-secondary field"
              onClick={(e) => fillDefaults(e.currentTarget.closest('form'), 'smtp')}
              type="button"
            >
              Use Microsoft 365 defaults
            </button>
            <label className="checkbox field-wide">
              <input defaultChecked={editing?.outboundSendEnabled ?? false} name="outboundSendEnabled" type="checkbox" /> Outbound sending
              enabled
            </label>
            {editing?.outboundSendEnabled === false && (
              <p className="field-wide text-sm text-amber-700">
                Enabling outbound sending will allow this mailbox to send real customer emails once a cutover date/time is also set. Confirm this
                is intended before saving.
              </p>
            )}
            <label className="field field-wide">
              <span>Outbound send cutover (messages queued before this instant are never sent)</span>
              <input
                defaultValue={editing?.outboundSendCutoverAt ? editing.outboundSendCutoverAt.slice(0, 16) : ''}
                name="outboundSendCutoverAt"
                type="datetime-local"
              />
            </label>

            <div className="field-wide flex gap-3">
              <button className="button-primary" type="submit">
                Save
              </button>
              <button className="button-secondary" onClick={() => setFormOpen(false)} type="button">
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
              <th>Scope / Mailbox</th>
              <th>Authentication</th>
              <th>IMAP</th>
              <th>SMTP</th>
              <th>Inbound Sync</th>
              <th>Outbound Sending</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>
                  {item.scope}
                  <br />
                  <span className="muted">{item.mailboxAddress}</span>
                </td>
                <td>{item.authMode === 'MICROSOFT_OAUTH2' ? 'Microsoft 365 OAuth2' : item.authMode === 'BASIC' ? 'Basic' : 'Not configured'}</td>
                <td>
                  {item.imapHost}:{item.imapPort}
                  <br />
                  <span className="muted">{testResults[`${item.id}-imap`] ?? 'Not tested this session'}</span>
                </td>
                <td>
                  {item.smtpHost}:{item.smtpPort}
                  <br />
                  <span className="muted">{testResults[`${item.id}-smtp`] ?? 'Not tested this session'}</span>
                </td>
                <td>{item.inboundSyncEnabled ? 'ON' : 'OFF'}</td>
                <td>{item.outboundSendEnabled ? 'ON' : 'OFF'}</td>
                <td>
                  {canManage && (
                    <div className="flex flex-col gap-1">
                      <button className="button-small" onClick={() => openEdit(item)} type="button">
                        Edit
                      </button>
                      <button className="button-small" onClick={() => void runTest(item.id, 'imap')} type="button">
                        Test IMAP
                      </button>
                      <button className="button-small" onClick={() => void runTest(item.id, 'smtp')} type="button">
                        Test SMTP
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted text-sm">
          A successful IMAP/SMTP test only proves the credentials/connection work from THIS API instance — it does not prove the background
          worker can use the same real adapter for actual sync/sending. See the Integration Health tab for the deployment-level Effective
          Status, which is the only place that combines configuration, this operational switch, and deployment adapter capability into one
          answer.
        </p>
      </section>
    </>
  );
}

function AiSettingsSection({ canManage }: { canManage: boolean }) {
  const [settings, setSettings] = useState<AiSettingsView | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [testResult, setTestResult] = useState('');
  const [confirmAutoAccept, setConfirmAutoAccept] = useState(false);

  async function load() {
    setSettings(await apiRequest<AiSettingsView>('/settings/ai'));
  }
  useEffect(() => {
    void load().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Load failed.'));
  }, []);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? '').trim();
    const autoRouteAccept = form.get('autoRouteAccept') === 'on';
    if (autoRouteAccept && !settings?.autoRouteAccept && !confirmAutoAccept) {
      setError('Please confirm the automatic-acceptance warning checkbox before enabling it.');
      return;
    }
    try {
      const body: Record<string, unknown> = {
        enabled: form.get('enabled') === 'on',
        model: value('model') || undefined,
        confidenceThreshold: value('confidenceThreshold') ? Number(value('confidenceThreshold')) : undefined,
        autoRouteAccept,
        autoRouteAcceptCutoverAt: value('autoRouteAcceptCutoverAt') ? new Date(value('autoRouteAcceptCutoverAt')).toISOString() : undefined,
      };
      if (value('apiKey')) body.apiKey = value('apiKey');
      if (form.get('clearApiKey') === 'on') body.clearApiKey = true;

      await apiRequest('/settings/ai', { method: 'PATCH', body: JSON.stringify(body) });
      setFormOpen(false);
      setError('');
      setMessage('AI settings saved and audited.');
      setConfirmAutoAccept(false);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Save failed.');
    }
  }

  async function runTest() {
    try {
      const result = await apiRequest<{ success: boolean; message: string; latencyMs?: number }>('/settings/ai/test', { method: 'POST' });
      setTestResult(result.success ? `Connected${result.latencyMs ? ` (${result.latencyMs}ms)` : ''}` : `Failed: ${result.message}`);
    } catch (cause) {
      setTestResult(cause instanceof Error ? cause.message : 'Test failed.');
    }
  }

  if (!settings) return <Notice message={error} />;

  return (
    <>
      {!formOpen && (
        <>
          <Notice message={error} />
          <Notice message={message} tone="success" />
        </>
      )}
      {formOpen && (
        <Modal maxWidth="36rem" onClose={() => setFormOpen(false)} title="Edit AI Settings">
          <Notice message={error} />
          <form className="form-grid" onSubmit={(e) => void save(e)}>
            <label className="checkbox field-wide">
              <input defaultChecked={settings.enabled} name="enabled" type="checkbox" /> AI Processing Enabled
            </label>
            <label className="field">
              <span>Provider</span>
              <input disabled value="OpenAI" />
            </label>
            <label className="field">
              <span>Model</span>
              <input defaultValue={settings.model ?? ''} name="model" placeholder="e.g. gpt-4.1" required />
            </label>
            <label className="field field-wide">
              <span>{settings.apiKeyConfigured ? 'Replace API Key (leave blank to keep the current one)' : 'API Key'}</span>
              <input autoComplete="new-password" name="apiKey" type="password" />
            </label>
            {settings.apiKeyConfigured && (
              <label className="checkbox field-wide">
                <input name="clearApiKey" type="checkbox" /> Clear stored API key
              </label>
            )}
            <label className="field">
              <span>Confidence threshold (0–1)</span>
              <input defaultValue={settings.confidenceThreshold ?? 0.9} max={1} min={0} name="confidenceThreshold" step={0.01} type="number" />
            </label>
            <label className="checkbox field-wide">
              <input
                defaultChecked={settings.autoRouteAccept}
                name="autoRouteAccept"
                onChange={(e) => setConfirmAutoAccept(e.target.checked ? confirmAutoAccept : false)}
                type="checkbox"
              />{' '}
              Automatic acceptance enabled
            </label>
            <label className="field field-wide">
              <span>Automatic acceptance cutover</span>
              <input
                defaultValue={settings.autoRouteAcceptCutoverAt ? settings.autoRouteAcceptCutoverAt.slice(0, 16) : ''}
                name="autoRouteAcceptCutoverAt"
                type="datetime-local"
              />
            </label>
            {!settings.autoRouteAccept && (
              <label className="checkbox field-wide">
                <input checked={confirmAutoAccept} onChange={(e) => setConfirmAutoAccept(e.target.checked)} type="checkbox" /> I understand
                enabling automatic acceptance allows the AI to automatically mark high-confidence renewal acceptances as ACCEPTED without human
                review, for messages received after the cutover.
              </label>
            )}
            <div className="field-wide flex gap-3">
              <button className="button-primary" type="submit">
                Save
              </button>
              <button className="button-secondary" onClick={() => setFormOpen(false)} type="button">
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      )}
      <section className="panel">
        <p>AI Processing: <strong>{settings.enabled ? 'ON' : 'OFF'}</strong></p>
        <p>Provider: {settings.provider}</p>
        <p>Model: {settings.model ?? 'Not configured'}</p>
        <p>API Key: {settings.apiKeyConfigured ? 'Configured' : 'Not configured'}</p>
        <p>Confidence threshold: {settings.confidenceThreshold ?? '—'}</p>
        <p>
          Automatic acceptance: <strong>{settings.autoRouteAccept ? 'ON' : 'OFF'}</strong>
          {settings.autoRouteAcceptCutoverAt ? ` (cutover ${new Date(settings.autoRouteAcceptCutoverAt).toLocaleString()})` : ''}
        </p>
        <p className="muted">Only high-confidence ACCEPT_RENEWAL classifications may ever auto-transition to ACCEPTED. REJECT_RENEWAL and PAYMENT_REPORTED — and everything else — always require human review.</p>
        {testResult && <p className="muted">Last test: {testResult}</p>}
        {canManage && (
          <div className="mt-4 flex gap-3">
            <button className="button-primary" onClick={() => setFormOpen(true)} type="button">
              Edit
            </button>
            <button className="button-secondary" onClick={() => void runTest()} type="button">
              Test AI
            </button>
          </div>
        )}
      </section>
    </>
  );
}

function IntegrationHealthSection() {
  const [overview, setOverview] = useState<HealthOverview | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    void apiRequest<HealthOverview>('/settings/health')
      .then(setOverview)
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Load failed.'));
  }, []);

  if (!overview) return <Notice message={error} />;

  return (
    <section className="panel table-wrap">
      <Notice message={error} />
      <table>
        <thead>
          <tr>
            <th>Integration</th>
            <th>Scope / Mailbox</th>
            <th>Last Test Result</th>
            <th>Last Checked</th>
            <th>Message</th>
            <th>Effective Status</th>
          </tr>
        </thead>
        <tbody>
          {overview.mail.map((row) => (
            <Fragment key={row.mailConfigurationId}>
              <tr>
                <td>SMTP</td>
                <td>
                  {row.scope}
                  <br />
                  <span className="muted">{row.label}</span>
                </td>
                <td>{row.smtp?.status ?? 'Never checked'}</td>
                <td>{row.smtp ? new Date(row.smtp.checkedAt).toLocaleString() : '—'}</td>
                <td>{row.smtp?.message ?? '—'}</td>
                <td>
                  <EffectiveStatusCell status={row.smtpStatus} />
                </td>
              </tr>
              <tr>
                <td>IMAP</td>
                <td>
                  {row.scope}
                  <br />
                  <span className="muted">{row.label}</span>
                </td>
                <td>{row.imap?.status ?? 'Never checked'}</td>
                <td>{row.imap ? new Date(row.imap.checkedAt).toLocaleString() : '—'}</td>
                <td>{row.imap?.message ?? '—'}</td>
                <td>
                  <EffectiveStatusCell status={row.imapStatus} />
                </td>
              </tr>
            </Fragment>
          ))}
          <tr>
            <td>AI</td>
            <td>Global</td>
            <td>{overview.ai?.status ?? 'Never checked'}</td>
            <td>{overview.ai ? new Date(overview.ai.checkedAt).toLocaleString() : '—'}</td>
            <td>{overview.ai?.message ?? '—'}</td>
            <td className="muted">No deployment-capability gate — see Settings → AI.</td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}
