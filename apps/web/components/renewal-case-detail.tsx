'use client';

import { workspaceStatus, mailDispatchStatus } from '../lib/workspace-status';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiRequest } from '../lib/api';
import { daysLeftLabel, daysUntilDue } from '../lib/renewal-timing';
import { useControlPanel } from './app-shell';
import { Modal } from './modal';
import { Notice } from './notice';
import { RenewalHumanCommunications } from './renewal-human-communications';
import { LegacyRenewalRecovery } from './p1-recovery-panels';
import { OutboundEvidenceControls } from './outbound-evidence-controls';

interface OutboxEntry {
  id: string;
  audience: string;
  recipient: string;
  subject: string;
  daysBeforeDue: number;
  purpose?: string | null;
  status: string;
  queuedAt: string;
  smtpUncertain: boolean;
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
  customerDecision: string;
  clarificationPending: boolean;
  communicationRevision: number;
  unreadReplyCount: number;
  reminderSummary: { acceptedCount: number; lastAcceptedAt: string | null; limited?: boolean };
  proposedPeriodStart: string | null;
  proposedPeriodEnd: string | null;
  proposedNextRenewalDate: string | null;
  invoices?: Array<{
    id: string;
    status: string;
    internalReference: string;
    fawtaraInvoiceNumber: string | null;
    renewalOfficialKey: string | null;
    verifiedOfficial: boolean;
  }>;
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
}

const MARK_ACTIONS = [
  { key: 'mark-accepted', label: 'Accept Renewal' },
  { key: 'mark-do-not-renew', label: 'Do Not Renew' },
  { key: 'mark-fulfilled', label: 'Mark Renewal Fulfilled' },
] as const;

// Mirrors apps/api/src/modules/renewal-cases/renewal-transition-policy.ts so the UI does not offer
// an action the backend will now correctly reject — this is a display convenience only, never the
// source of authorization truth: the backend's own compare-and-swap check is authoritative
// regardless of what this map says.
const MARK_ACTION_LEGAL_FROM: Record<(typeof MARK_ACTIONS)[number]['key'], string[]> = {
  'mark-accepted': ['UPCOMING', 'REMINDER_CYCLE', 'AWAITING_CUSTOMER', 'HUMAN_REVIEW'],
  'mark-do-not-renew': ['UPCOMING', 'REMINDER_CYCLE', 'AWAITING_CUSTOMER', 'HUMAN_REVIEW'],
  'mark-fulfilled': ['ACCEPTED'],
};

const TERMINAL_STATUSES = new Set(['CLOSED', 'FULFILLED', 'REJECTED', 'DO_NOT_RENEW']);

export function RenewalCaseDetail({
  caseId,
  prepareOnOpen = false,
  onClose,
  onChanged,
}: {
  caseId: string;
  prepareOnOpen?: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { can } = useControlPanel();
  const canManage = can('ADMIN');
  const [detail, setDetail] = useState<RenewalCaseDetailData | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [holdReason, setHoldReason] = useState('');
  const [holdFormOpen, setHoldFormOpen] = useState(false);

  async function load() {
    const caseResult = await apiRequest<RenewalCaseDetailData>(`/renewal-cases/${caseId}`);
    setDetail(caseResult);
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

  async function refreshCase() {
    await load();
    onChanged();
  }

  async function runAction(path: string, successMessage: string) {
    try {
      if ((path === 'mark-accepted' || path === 'mark-do-not-renew') && !window.confirm('Record the customer decision received outside this CRM email conversation?')) return;
      await apiRequest(`/renewal-cases/${caseId}/${path}`, { method: 'POST', ...((path === 'mark-accepted' || path === 'mark-do-not-renew') ? { body: JSON.stringify({ expectedRevision: detail?.communicationRevision }) } : {}) });
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

  async function createRenewalInvoice() {
    try {
      await apiRequest(`/invoices/from-renewal/${caseId}`, { method: 'POST' });
      setMessage('Renewal invoice draft created.');
      setError('');
      await load();
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to create the renewal invoice draft.');
    }
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
          prepareOnOpen={prepareOnOpen}
          onChanged={refreshCase}
          detail={detail}
          holdFormOpen={holdFormOpen}
          holdReason={holdReason}
          onHoldReasonChange={setHoldReason}
          onOpenHoldForm={() => setHoldFormOpen(true)}
          onCancelHoldForm={() => setHoldFormOpen(false)}
          onSubmitHold={submitHold}
          onRelease={release}
          onMarkAction={runAction}
          onCreateRenewalInvoice={createRenewalInvoice}
        />
      )}
    </Modal>
  );
}

function RenewalCaseBody({
  canManage,
  prepareOnOpen,
  onChanged,
  detail,
  holdFormOpen,
  holdReason,
  onHoldReasonChange,
  onOpenHoldForm,
  onCancelHoldForm,
  onSubmitHold,
  onRelease,
  onMarkAction,
  onCreateRenewalInvoice,
}: {
  canManage: boolean;
  prepareOnOpen: boolean;
  onChanged: () => Promise<void>;
  detail: RenewalCaseDetailData;
  holdFormOpen: boolean;
  holdReason: string;
  onHoldReasonChange: (value: string) => void;
  onOpenHoldForm: () => void;
  onCancelHoldForm: () => void;
  onSubmitHold: (event: React.FormEvent<HTMLFormElement>) => void;
  onRelease: (holdId: string) => void;
  onMarkAction: (path: string, successMessage: string) => void;
  onCreateRenewalInvoice: () => void;
}) {
  const asOf = new Date().toISOString();
  const daysLeft = daysUntilDue(detail.dueDate, asOf);
  const activeHold = detail.holds.find(
    (hold) => hold.active && (!hold.expiresAt || new Date(hold.expiresAt) > new Date()),
  );
  const { customer } = detail.subscription;
  const isTerminal = TERMINAL_STATUSES.has(detail.status);
  const invoices = detail.invoices ?? [];
  const approvedRenewal = detail.status === 'ACCEPTED' && detail.customerDecision === 'ACCEPTED' &&
    Boolean(detail.proposedPeriodStart && detail.proposedPeriodEnd && detail.proposedNextRenewalDate);
  const hasOfficialRenewalInvoice = invoices.some((invoice) =>
    invoice.renewalOfficialKey === detail.id && invoice.verifiedOfficial);

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
            <span className="status-pill">{workspaceStatus(detail.status)}</span>
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

      {canManage && <RenewalHumanCommunications caseId={detail.id} status={detail.status} communicationRevision={detail.communicationRevision} clarificationPending={detail.clarificationPending} canManage={canManage} onChanged={onChanged} prepareOnOpen={prepareOnOpen} />}
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
            <span className="muted">Subscription status:</span> {workspaceStatus(detail.subscription.status)}
          </p>
        </div>
      </section>

      {detail.status === 'ACCEPTED' && <section className="space-y-2">
        <h4 className="font-medium">Proposed renewal period</h4>
        <p>{detail.proposedPeriodStart?.slice(0, 10) ?? 'Missing'} – {detail.proposedPeriodEnd?.slice(0, 10) ?? 'Missing'}</p>
        <p>Next renewal: {detail.proposedNextRenewalDate?.slice(0, 10) ?? 'Missing'}. The subscription date changes only after fulfillment.</p>
        <LegacyRenewalRecovery caseId={detail.id} status={detail.status} dueDate={detail.dueDate} periodStart={detail.proposedPeriodStart} periodEnd={detail.proposedPeriodEnd} nextRenewalDate={detail.proposedNextRenewalDate} onChanged={onChanged} />
      </section>}
      <section>
        <p>SMTP-accepted reminders: {detail.reminderSummary.acceptedCount} · Last accepted: {detail.reminderSummary.lastAcceptedAt ? new Date(detail.reminderSummary.lastAcceptedAt).toLocaleString() : '—'}</p>
        {detail.reminderSummary.limited && <p className="muted">Some historical evidence requires review; count is a confirmed minimum.</p>}
        <p className="muted">Reminders are prepared and sent manually. Due dates do not trigger customer email.</p>
      </section>

      <section>
        <h4 className="font-medium">Communication history</h4>
        {detail.communicationOutbox.length ? (
          <div className="table-wrap mt-2">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Queued</th>
                  <th>Message type</th>
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
                    <td>{entry.purpose === 'REMINDER' ? 'Manual reminder' : entry.purpose === 'CLARIFICATION' ? 'Clarification' : entry.audience === 'INTERNAL' ? 'Internal notification' : 'Historical message'}</td>
                    <td>{workspaceStatus(entry.audience)}</td>
                    <td>{entry.recipient}</td>
                    <td>{entry.subject}</td>
                    <td>{mailDispatchStatus(entry.status, entry.smtpUncertain)}{canManage && entry.audience === 'CUSTOMER' && <OutboundEvidenceControls path={`/renewal-cases/${detail.id}/outbox/${entry.id}`} onChanged={() => void onChanged().catch(() => undefined)} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted mt-2 text-sm">No communication has been queued for this case yet.</p>
        )}
      </section>

      {(approvedRenewal || invoices.length > 0) && (
        <section>
          <h4 className="font-medium">Renewal invoices</h4>
          {invoices.length > 0 && (
            <ul className="mt-2 space-y-1">
              {invoices.map((invoice) => (
                <li key={invoice.id}>
                  <Link className="underline" href={`/dashboard/invoices/${invoice.id}`}>
                    {invoice.fawtaraInvoiceNumber ?? invoice.internalReference}
                  </Link>
                  <span className="muted ml-2">{workspaceStatus(invoice.status)}</span>
                </li>
              ))}
            </ul>
          )}
          {canManage && approvedRenewal && !hasOfficialRenewalInvoice &&
            !invoices.some((invoice) => ['DRAFT', 'READY_FOR_FAWTARA', 'FAWTARA_REJECTED'].includes(invoice.status)) && (
              <button className="button-small mt-2" onClick={onCreateRenewalInvoice} type="button">
                Create Renewal Invoice Draft
              </button>
          )}
        </section>
      )}

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
              MARK_ACTIONS.filter((action) =>
                MARK_ACTION_LEGAL_FROM[action.key].includes(detail.status) &&
                  (action.key === 'mark-fulfilled' || detail.unreadReplyCount === 0) &&
                  (action.key !== 'mark-fulfilled' || (approvedRenewal && hasOfficialRenewalInvoice)),
              ).map((action) => (
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
                  {action.key === 'mark-fulfilled' ? action.label : `${action.label} (outside email)`}
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
