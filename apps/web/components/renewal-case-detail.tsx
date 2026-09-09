'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiRequest } from '../lib/api';
import { daysLeftLabel, daysUntilDue } from '../lib/renewal-timing';
import { useControlPanel } from './app-shell';
import { Modal } from './modal';
import { Notice } from './notice';

interface ReminderRuleOption {
  id: string;
  code: string;
  name: string;
  daysBeforeDue: number;
  enabled: boolean;
}

interface OutboxEntry {
  id: string;
  audience: string;
  recipient: string;
  subject: string;
  daysBeforeDue: number;
  status: string;
  queuedAt: string;
}

interface EvaluationDecision {
  id: string;
  outcome: string;
  daysBeforeDue: number | null;
  reason: string | null;
  createdAt: string;
}

interface HoldEntry {
  id: string;
  reason: string;
  active: boolean;
  expiresAt: string | null;
  createdAt: string;
}

interface RenewalCaseDetailData {
  id: string;
  dueDate: string;
  status: string;
  subscription: {
    id: string;
    subscriptionCode: string;
    name: string;
    status: string;
    renewalDate: string;
    sellingPrice: string;
    currency: string;
    packageNameSnapshot: string | null;
    serviceType: { name: string };
    servicePackage: { name: string } | null;
    customer: {
      id: string;
      customerCode: string;
      nameEn: string | null;
      nameAr: string | null;
      contactName: string | null;
      primaryEmail: string;
      phone: string | null;
      billingEntity: { name: string };
    };
  };
  holds: HoldEntry[];
  communicationOutbox: OutboxEntry[];
  evaluationDecisions: EvaluationDecision[];
}

const DECISION_OUTCOME_LABEL: Record<string, string> = {
  SKIPPED_HOLD: 'Skipped — on hold',
  SKIPPED_INELIGIBLE: 'Skipped — ineligible',
  DUPLICATE_PREVENTED: 'Duplicate prevented',
};

function milestoneLabel(
  daysBeforeDue: number,
  daysLeft: number,
  outbox: OutboxEntry[],
  decisions: EvaluationDecision[],
): string {
  const matching = outbox
    .filter((entry) => entry.audience === 'CUSTOMER' && entry.daysBeforeDue === daysBeforeDue)
    .sort((a, b) => b.queuedAt.localeCompare(a.queuedAt));
  const latest = matching[0];
  if (latest) {
    if (latest.status === 'DELIVERED') return `Sent ${latest.queuedAt.slice(0, 10)}`;
    if (latest.status === 'FAILED') return 'Failed';
    if (latest.status === 'QUEUED' || latest.status === 'PROCESSING') return 'Queued';
    if (latest.status === 'CANCELLED') return 'Cancelled';
  }
  if (daysLeft > daysBeforeDue) return 'Not yet due';
  const decision = decisions.find((entry) => entry.daysBeforeDue === daysBeforeDue);
  if (decision) return DECISION_OUTCOME_LABEL[decision.outcome] ?? 'Skipped';
  return 'Pending';
}

const MARK_ACTIONS = [
  { key: 'mark-awaiting-customer', label: 'Mark awaiting customer' },
  { key: 'mark-accepted', label: 'Mark accepted' },
  { key: 'mark-do-not-renew', label: 'Mark do not renew' },
  { key: 'mark-fulfilled', label: 'Mark fulfilled' },
] as const;

const TERMINAL_STATUSES = new Set(['CLOSED', 'FULFILLED', 'REJECTED', 'DO_NOT_RENEW']);

export function RenewalCaseDetail({
  caseId,
  onClose,
  onChanged,
}: {
  caseId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { can } = useControlPanel();
  const canManage = can('ADMIN', 'ACCOUNTANT', 'IT', 'SALES_DEVELOPMENT');
  const [detail, setDetail] = useState<RenewalCaseDetailData | null>(null);
  const [reminderRules, setReminderRules] = useState<ReminderRuleOption[]>([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [holdReason, setHoldReason] = useState('');
  const [holdFormOpen, setHoldFormOpen] = useState(false);

  async function load() {
    const [caseResult, configResult] = await Promise.all([
      apiRequest<RenewalCaseDetailData>(`/renewal-cases/${caseId}`),
      apiRequest<{ reminderRules: ReminderRuleOption[] }>('/renewal-configuration'),
    ]);
    setDetail(caseResult);
    setReminderRules(configResult.reminderRules ?? []);
  }

  useEffect(() => {
    // setError only ever fires inside the .catch callback, after the fetch settles — not
    // synchronously during this render — but the heuristic can't tell that apart from a
    // same-tick setState here, so it needs the explicit opt-out.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load().catch((cause: unknown) =>
      setError(cause instanceof Error ? cause.message : 'Unable to load the renewal case.'),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId]);

  async function runAction(path: string, successMessage: string) {
    try {
      await apiRequest(`/renewal-cases/${caseId}/${path}`, { method: 'POST' });
      setMessage(successMessage);
      setError('');
      await load();
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Action failed.');
    }
  }

  async function submitHold(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!holdReason.trim()) return;
    try {
      await apiRequest(`/renewal-cases/${caseId}/holds`, {
        method: 'POST',
        body: JSON.stringify({ reason: holdReason.trim() }),
      });
      setHoldFormOpen(false);
      setHoldReason('');
      setMessage('Workflow hold created.');
      setError('');
      await load();
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Hold failed.');
    }
  }

  async function release(holdId: string) {
    await runAction(`holds/${holdId}/release`, 'Workflow hold released.');
  }

  return (
    <Modal
      maxWidth="52rem"
      onClose={onClose}
      title={detail ? `Renewal ${detail.subscription.subscriptionCode}` : 'Loading…'}
    >
      <Notice message={error} />
      <Notice message={message} tone="success" />
      {!detail ? (
        <p className="muted text-sm">Loading renewal case…</p>
      ) : (
        <RenewalCaseBody
          canManage={canManage}
          detail={detail}
          holdFormOpen={holdFormOpen}
          holdReason={holdReason}
          onHoldReasonChange={setHoldReason}
          onOpenHoldForm={() => setHoldFormOpen(true)}
          onCancelHoldForm={() => setHoldFormOpen(false)}
          onSubmitHold={submitHold}
          onRelease={release}
          onMarkAction={runAction}
          reminderRules={reminderRules}
        />
      )}
    </Modal>
  );
}

function RenewalCaseBody({
  canManage,
  detail,
  holdFormOpen,
  holdReason,
  onHoldReasonChange,
  onOpenHoldForm,
  onCancelHoldForm,
  onSubmitHold,
  onRelease,
  onMarkAction,
  reminderRules,
}: {
  canManage: boolean;
  detail: RenewalCaseDetailData;
  holdFormOpen: boolean;
  holdReason: string;
  onHoldReasonChange: (value: string) => void;
  onOpenHoldForm: () => void;
  onCancelHoldForm: () => void;
  onSubmitHold: (event: React.FormEvent<HTMLFormElement>) => void;
  onRelease: (holdId: string) => void;
  onMarkAction: (path: string, successMessage: string) => void;
  reminderRules: ReminderRuleOption[];
}) {
  const asOf = new Date().toISOString();
  const daysLeft = daysUntilDue(detail.dueDate, asOf);
  const activeHold = detail.holds.find(
    (hold) => hold.active && (!hold.expiresAt || new Date(hold.expiresAt) > new Date()),
  );
  const milestones = [...reminderRules]
    .filter((rule) => rule.enabled)
    .sort((a, b) => b.daysBeforeDue - a.daysBeforeDue);
  const { customer } = detail.subscription;
  const isTerminal = TERMINAL_STATUSES.has(detail.status);

  return (
    <div className="space-y-6">
      <section>
        <h4 className="font-medium">Renewal summary</h4>
        <div className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
          <p>
            <span className="muted">Due date:</span> {detail.dueDate.slice(0, 10)}
          </p>
          <p>
            <span className="muted">Days remaining:</span> {daysLeftLabel(daysLeft)}
          </p>
          <p>
            <span className="muted">Status:</span>{' '}
            <span className="status-pill">{detail.status}</span>
          </p>
          <p>
            <span className="muted">Hold:</span>{' '}
            {activeHold ? (
              <span className="status-pill danger">On hold — {activeHold.reason}</span>
            ) : (
              '—'
            )}
          </p>
        </div>
      </section>

      <section className="rounded-lg border border-[var(--line)] p-4">
        <div className="flex items-center justify-between gap-3">
          <h4 className="font-medium">Customer</h4>
          <Link className="button-small" href={`/dashboard/customers/${customer.id}`}>
            Open customer
          </Link>
        </div>
        <div className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
          <p>
            <span className="muted">Customer Code:</span> {customer.customerCode}
          </p>
          <p>
            <span className="muted">Billing Entity:</span> {customer.billingEntity.name}
          </p>
          <p>
            <span className="muted">English name:</span> {customer.nameEn ?? '—'}
          </p>
          <p dir="auto">
            <span className="muted">Arabic name:</span> {customer.nameAr ?? '—'}
          </p>
          <p>
            <span className="muted">Primary email:</span> {customer.primaryEmail}
          </p>
          <p>
            <span className="muted">Phone:</span> {customer.phone ?? '—'}
          </p>
        </div>
      </section>

      <section className="rounded-lg border border-[var(--line)] p-4">
        <div className="flex items-center justify-between gap-3">
          <h4 className="font-medium">Subscription</h4>
          <Link
            className="button-small"
            href={`/dashboard/subscriptions?edit=${detail.subscription.id}`}
          >
            Open subscription
          </Link>
        </div>
        <div className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
          <p>
            <span className="muted">Subscription Code:</span> {detail.subscription.subscriptionCode}
          </p>
          <p>
            <span className="muted">Name:</span> {detail.subscription.name}
          </p>
          <p>
            <span className="muted">Service Type:</span> {detail.subscription.serviceType.name}
          </p>
          <p>
            <span className="muted">Package:</span>{' '}
            {detail.subscription.packageNameSnapshot ??
              detail.subscription.servicePackage?.name ??
              'Unclassified'}
          </p>
          <p>
            <span className="muted">Price:</span> {detail.subscription.sellingPrice}{' '}
            {detail.subscription.currency}
          </p>
          <p>
            <span className="muted">Subscription status:</span> {detail.subscription.status}
          </p>
        </div>
      </section>

      <section>
        <h4 className="font-medium">Renewal timeline</h4>
        {milestones.length ? (
          <ul className="mt-2 space-y-1 text-sm">
            {milestones.map((rule) => (
              <li
                className="flex justify-between gap-3 border-b border-[var(--line)] py-1"
                key={rule.id}
              >
                <span>D-{rule.daysBeforeDue}</span>
                <span className="muted">
                  {milestoneLabel(
                    rule.daysBeforeDue,
                    daysLeft,
                    detail.communicationOutbox,
                    detail.evaluationDecisions,
                  )}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted mt-2 text-sm">No enabled reminder milestones are configured.</p>
        )}
      </section>

      <section>
        <h4 className="font-medium">Communication history</h4>
        {detail.communicationOutbox.length ? (
          <div className="table-wrap mt-2">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Queued</th>
                  <th>Milestone</th>
                  <th>Audience</th>
                  <th>Recipient</th>
                  <th>Subject</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {detail.communicationOutbox.map((entry) => (
                  <tr key={entry.id}>
                    <td>{new Date(entry.queuedAt).toLocaleString()}</td>
                    <td>{entry.daysBeforeDue === 0 ? 'D0' : `D-${entry.daysBeforeDue}`}</td>
                    <td>{entry.audience}</td>
                    <td>{entry.recipient}</td>
                    <td>{entry.subject}</td>
                    <td>{entry.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted mt-2 text-sm">No communication has been queued for this case yet.</p>
        )}
      </section>

      {canManage && (
        <section>
          <h4 className="font-medium">Actions</h4>
          <div className="mt-2 flex flex-wrap gap-2">
            {activeHold ? (
              <button
                className="button-small"
                onClick={() => onRelease(activeHold.id)}
                type="button"
              >
                Release hold
              </button>
            ) : holdFormOpen ? null : (
              <button className="button-small" onClick={onOpenHoldForm} type="button">
                Put on hold
              </button>
            )}
            {!isTerminal &&
              MARK_ACTIONS.map((action) => (
                <button
                  className="button-small"
                  key={action.key}
                  onClick={() =>
                    onMarkAction(
                      action.key,
                      `Renewal case ${action.label.replace('Mark ', '').toLowerCase()}.`,
                    )
                  }
                  type="button"
                >
                  {action.label}
                </button>
              ))}
          </div>
          {holdFormOpen && !activeHold && (
            <form className="form-grid mt-3" onSubmit={onSubmitHold}>
              <label className="field field-wide">
                <span>Hold reason</span>
                <input
                  onChange={(event) => onHoldReasonChange(event.target.value)}
                  required
                  value={holdReason}
                />
              </label>
              <div className="field-wide flex gap-3">
                <button className="button-primary" type="submit">
                  Save hold
                </button>
                <button className="button-secondary" onClick={onCancelHoldForm} type="button">
                  Cancel
                </button>
              </div>
            </form>
          )}
        </section>
      )}
    </div>
  );
}
