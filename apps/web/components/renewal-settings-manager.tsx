'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '../lib/api';
import { Notice } from './notice';
import { PageHeading } from './page-heading';

interface RenewalTemplate {
  id: string;
  code: string;
  name: string;
  subjectTemplate: string;
  bodyTemplate: string;
  enabled: boolean;
}

interface ReminderRule {
  id: string;
  code: string;
  name: string;
  daysBeforeDue: number;
  enabled: boolean;
  templateId: string;
}

interface NotificationRule {
  id: string;
  code: string;
  name: string;
  daysBeforeDue: number;
  recipientRoles: string[];
  recipientEmails: string[];
  suppressOnWorkflowHold: boolean;
  enabled: boolean;
}

interface Configuration {
  templates: RenewalTemplate[];
  reminderRules: ReminderRule[];
  notificationRules: NotificationRule[];
}

export function RenewalSettingsManager() {
  const [configuration, setConfiguration] = useState<Configuration | null>(null);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setConfiguration(await apiRequest<Configuration>('/renewal-configuration'));
  }, []);

  useEffect(() => {
    void load().catch((error: unknown) =>
      setNotice(error instanceof Error ? error.message : 'Unable to load renewal configuration.'),
    );
  }, [load]);

  async function patch(path: string, body: Record<string, unknown>, message: string) {
    await apiRequest(path, { method: 'PATCH', body: JSON.stringify(body) });
    setNotice(message);
    await load();
  }

  async function runEngine() {
    const result = await apiRequest<{ jobId: string }>('/renewal-engine/run', {
      method: 'POST',
      body: JSON.stringify({ reason: 'Manual execution from renewal settings' }),
    });
    setNotice(`Renewal evaluation queued as BullMQ job ${result.jobId}.`);
  }

  return (
    <>
      <PageHeading
        title="Renewal configuration"
        description="Customer milestones, allowlisted operational templates, configurable internal recipients, and the controlled manual evaluation trigger."
        actions={
          <button className="button-primary" onClick={() => void runEngine()} type="button">
            Queue renewal evaluation
          </button>
        }
      />
      <Notice message={notice} />
      {!configuration ? (
        <p className="text-sm text-[var(--muted)]">Loading renewal configuration…</p>
      ) : (
        <div className="space-y-6">
          <section className="panel">
            <h3 className="text-lg font-semibold">Customer reminder rules</h3>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              {configuration.reminderRules.map((rule) => (
                <form
                  className="rounded-xl border border-[var(--line)] p-4"
                  key={rule.id}
                  onSubmit={(event) => {
                    event.preventDefault();
                    const data = new FormData(event.currentTarget);
                    void patch(
                      `/renewal-configuration/reminder-rules/${rule.id}`,
                      {
                        daysBeforeDue: Number(data.get('daysBeforeDue')),
                        templateId: String(data.get('templateId')),
                        enabled: data.get('enabled') === 'on',
                      },
                      `${rule.name} updated.`,
                    );
                  }}
                >
                  <p className="font-medium">{rule.name}</p>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <label className="text-sm">
                      Days before due
                      <input
                        className="input mt-1"
                        defaultValue={rule.daysBeforeDue}
                        name="daysBeforeDue"
                        type="number"
                        min="0"
                        max="365"
                      />
                    </label>
                    <label className="text-sm">
                      Template
                      <select
                        className="input mt-1"
                        defaultValue={rule.templateId}
                        name="templateId"
                      >
                        {configuration.templates.map((template) => (
                          <option key={template.id} value={template.id}>
                            {template.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <label className="mt-3 flex gap-2 text-sm">
                    <input defaultChecked={rule.enabled} name="enabled" type="checkbox" /> Enabled
                  </label>
                  <button className="button-secondary mt-3" type="submit">
                    Save rule
                  </button>
                </form>
              ))}
            </div>
          </section>

          <section className="panel">
            <h3 className="text-lg font-semibold">Customer templates</h3>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Only approved renewal placeholders are accepted. No marketing or LLM template behavior
              is included.
            </p>
            <div className="mt-4 space-y-4">
              {configuration.templates.map((template) => (
                <form
                  className="rounded-xl border border-[var(--line)] p-4"
                  key={template.id}
                  onSubmit={(event) => {
                    event.preventDefault();
                    const data = new FormData(event.currentTarget);
                    void patch(
                      `/renewal-configuration/templates/${template.id}`,
                      {
                        name: String(data.get('name')),
                        subjectTemplate: String(data.get('subjectTemplate')),
                        bodyTemplate: String(data.get('bodyTemplate')),
                        enabled: data.get('enabled') === 'on',
                      },
                      `${template.code} template updated.`,
                    );
                  }}
                >
                  <div className="grid gap-3 lg:grid-cols-2">
                    <label className="text-sm">
                      Name
                      <input className="input mt-1" defaultValue={template.name} name="name" />
                    </label>
                    <label className="text-sm">
                      Subject
                      <input
                        className="input mt-1"
                        defaultValue={template.subjectTemplate}
                        name="subjectTemplate"
                      />
                    </label>
                  </div>
                  <label className="mt-3 block text-sm">
                    Body
                    <textarea
                      className="input mt-1 min-h-28"
                      defaultValue={template.bodyTemplate}
                      name="bodyTemplate"
                    />
                  </label>
                  <label className="mt-3 flex gap-2 text-sm">
                    <input defaultChecked={template.enabled} name="enabled" type="checkbox" />{' '}
                    Enabled
                  </label>
                  <button className="button-secondary mt-3" type="submit">
                    Save template
                  </button>
                </form>
              ))}
            </div>
          </section>

          <section className="panel">
            <h3 className="text-lg font-semibold">Internal notification rules</h3>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              {configuration.notificationRules.map((rule) => (
                <form
                  className="rounded-xl border border-[var(--line)] p-4"
                  key={rule.id}
                  onSubmit={(event) => {
                    event.preventDefault();
                    const data = new FormData(event.currentTarget);
                    const split = (name: string) =>
                      String(data.get(name) ?? '')
                        .split(',')
                        .map((value) => value.trim())
                        .filter(Boolean);
                    void patch(
                      `/renewal-configuration/notification-rules/${rule.id}`,
                      {
                        recipientRoles: split('recipientRoles'),
                        recipientEmails: split('recipientEmails'),
                        enabled: data.get('enabled') === 'on',
                        suppressOnWorkflowHold: data.get('suppressOnWorkflowHold') === 'on',
                      },
                      `${rule.name} updated.`,
                    );
                  }}
                >
                  <p className="font-medium">
                    {rule.name} · {rule.daysBeforeDue === 0 ? 'D0' : `D-${rule.daysBeforeDue}`}
                  </p>
                  <label className="mt-3 block text-sm">
                    Recipient roles
                    <input
                      className="input mt-1"
                      defaultValue={rule.recipientRoles.join(', ')}
                      name="recipientRoles"
                    />
                  </label>
                  <label className="mt-3 block text-sm">
                    Additional emails
                    <input
                      className="input mt-1"
                      defaultValue={rule.recipientEmails.join(', ')}
                      name="recipientEmails"
                      type="text"
                    />
                  </label>
                  <label className="mt-3 flex gap-2 text-sm">
                    <input defaultChecked={rule.enabled} name="enabled" type="checkbox" /> Enabled
                  </label>
                  <label className="mt-2 flex gap-2 text-sm">
                    <input
                      defaultChecked={rule.suppressOnWorkflowHold}
                      name="suppressOnWorkflowHold"
                      type="checkbox"
                    />{' '}
                    Suppress when hold policy stops internal notifications
                  </label>
                  <button className="button-secondary mt-3" type="submit">
                    Save notification rule
                  </button>
                </form>
              ))}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
