'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { apiRequest, type PageResult } from '../lib/api';
import { customerDisplayName } from '../lib/customer-name';
import {
  daysLeftLabel,
  daysUntilDue,
  reminderStatusLabel,
  urgencyOf,
  URGENCY_LABEL,
  type Urgency,
} from '../lib/renewal-timing';
import { Notice } from './notice';
import { PageHeading } from './page-heading';
import { RenewalCaseDetail } from './renewal-case-detail';
import { useControlPanel } from './app-shell';

interface RenewalHold {
  id: string;
  reason: string;
  active: boolean;
  expiresAt?: string | null;
}

interface RenewalCase {
  id: string;
  dueDate: string;
  status: string;
  subscription: {
    id: string;
    subscriptionCode: string;
    name: string;
    status: string;
    sellingPrice: string;
    currency: string;
    packageNameSnapshot: string | null;
    customer: {
      id: string;
      customerCode: string;
      nameEn: string | null;
      nameAr: string | null;
      billingEntity: { name: string };
    };
    serviceType: { name: string };
    servicePackage: { name: string } | null;
  };
  holds: RenewalHold[];
  communicationOutbox: Array<{ status: string; queuedAt: string; audience: string }>;
  _count: { communicationOutbox: number };
}

interface RenewalSummary {
  dueWithin7Days: number;
  dueWithin30Days: number;
  overdue: number;
  awaitingCustomer: number;
  onHold: number;
}

interface ServiceTypeOption {
  id: string;
  name: string;
}

interface PackageOption {
  id: string;
  serviceTypeId: string;
  name: string;
}

interface BillingEntityOption {
  id: string;
  name: string;
}

interface OutboxMessage {
  id: string;
  audience: string;
  recipient: string;
  subject: string;
  daysBeforeDue: number;
  status: string;
  queuedAt: string;
  customer: { nameEn: string | null; nameAr: string | null };
  subscription: { name: string };
}

const STATUS_OPTIONS = [
  'UPCOMING',
  'REMINDER_CYCLE',
  'AWAITING_CUSTOMER',
  'HUMAN_REVIEW',
  'ACCEPTED',
  'REJECTED',
  'FULFILLED',
  'DO_NOT_RENEW',
  'SUSPENDED',
  'CLOSED',
  'ERROR',
];

const URGENCY_OPTIONS: Urgency[] = ['overdue', 'today', 'week', 'month'];

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(base: Date, days: number): Date {
  const result = new Date(base);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

export function RenewalCasesManager() {
  const { can } = useControlPanel();
  const canHold = can('ADMIN', 'ACCOUNTANT', 'IT', 'SALES_DEVELOPMENT');

  const [cases, setCases] = useState<RenewalCase[]>([]);
  const [asOf, setAsOf] = useState('');
  const [summary, setSummary] = useState<RenewalSummary | null>(null);
  const [outbox, setOutbox] = useState<OutboxMessage[]>([]);
  const [serviceTypes, setServiceTypes] = useState<ServiceTypeOption[]>([]);
  const [packages, setPackages] = useState<PackageOption[]>([]);
  const [billingEntities, setBillingEntities] = useState<BillingEntityOption[]>([]);

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [holdStatus, setHoldStatus] = useState('');
  const [serviceTypeId, setServiceTypeId] = useState('');
  const [servicePackageId, setServicePackageId] = useState('');
  const [billingEntityId, setBillingEntityId] = useState('');
  const [urgency, setUrgency] = useState('');
  const [dueFrom, setDueFrom] = useState('');
  const [dueTo, setDueTo] = useState('');

  const [holdTarget, setHoldTarget] = useState<string | null>(null);
  const [holdReason, setHoldReason] = useState('');
  const [detailCaseId, setDetailCaseId] = useState<string | null>(null);
  const [outboxOpen, setOutboxOpen] = useState(false);
  const [outboxSearch, setOutboxSearch] = useState('');
  const [outboxStatus, setOutboxStatus] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const hasFilters = Boolean(
    search ||
    status ||
    holdStatus ||
    serviceTypeId ||
    servicePackageId ||
    billingEntityId ||
    urgency ||
    dueFrom ||
    dueTo,
  );

  const load = useCallback(async () => {
    const params = new URLSearchParams({ pageSize: '50' });
    if (search) params.set('search', search);
    if (status) params.set('status', status);
    if (holdStatus) params.set('holdStatus', holdStatus);
    if (serviceTypeId) params.set('serviceTypeId', serviceTypeId);
    if (servicePackageId) params.set('servicePackageId', servicePackageId);
    if (billingEntityId) params.set('billingEntityId', billingEntityId);
    if (dueFrom) params.set('dueFrom', dueFrom);
    if (dueTo) params.set('dueTo', dueTo);
    // /service-types, /service-packages, and /billing-entities are not paginated: they return
    // plain arrays directly, unlike /renewal-cases and /communication-outbox, which both return
    // { data, meta }. See the /service-types crash this page had before for exactly what goes
    // wrong when that distinction is assumed wrong.
    const [caseResult, outboxResult, serviceTypeResult, packageResult, billingEntityResult] =
      await Promise.all([
        apiRequest<PageResult<RenewalCase> & { asOf: string }>(`/renewal-cases?${params}`),
        apiRequest<PageResult<OutboxMessage>>('/communication-outbox?pageSize=50'),
        apiRequest<ServiceTypeOption[]>('/service-types'),
        apiRequest<PackageOption[]>('/service-packages'),
        apiRequest<BillingEntityOption[]>('/billing-entities'),
      ]);
    // Defensive fallback to [] on every array-typed state: a future endpoint contract drift
    // should degrade to an empty list here, never crash the page on a stray .map() over
    // undefined.
    setCases(caseResult.data ?? []);
    setAsOf(caseResult.asOf ?? new Date().toISOString());
    setOutbox(outboxResult.data ?? []);
    setServiceTypes(serviceTypeResult ?? []);
    setPackages(packageResult ?? []);
    setBillingEntities(billingEntityResult ?? []);
  }, [
    search,
    status,
    holdStatus,
    serviceTypeId,
    servicePackageId,
    billingEntityId,
    dueFrom,
    dueTo,
  ]);

  const loadSummary = useCallback(async () => {
    setSummary(await apiRequest<RenewalSummary>('/renewal-cases/summary'));
  }, []);

  useEffect(() => {
    void load().catch((cause: unknown) =>
      setError(cause instanceof Error ? cause.message : 'Unable to load renewals.'),
    );
  }, [load]);

  useEffect(() => {
    void loadSummary().catch(() => {
      // The overview cards are a nice-to-have above the table; if they fail to load, the
      // filtered table below (already guarded by its own error state) still works.
    });
  }, [loadSummary]);

  function selectUrgency(value: string) {
    setUrgency(value);
    const today = new Date();
    if (value === 'overdue') {
      setDueFrom('');
      setDueTo(isoDate(addDays(today, -1)));
    } else if (value === 'today') {
      setDueFrom(isoDate(today));
      setDueTo(isoDate(today));
    } else if (value === 'week') {
      setDueFrom(isoDate(today));
      setDueTo(isoDate(addDays(today, 7)));
    } else if (value === 'month') {
      setDueFrom(isoDate(today));
      setDueTo(isoDate(addDays(today, 30)));
    } else {
      setDueFrom('');
      setDueTo('');
    }
  }

  function clearFilters() {
    setSearch('');
    setStatus('');
    setHoldStatus('');
    setServiceTypeId('');
    setServicePackageId('');
    setBillingEntityId('');
    setUrgency('');
    setDueFrom('');
    setDueTo('');
  }

  async function createHold() {
    if (!holdTarget || !holdReason.trim()) return;
    try {
      await apiRequest(`/renewal-cases/${holdTarget}/holds`, {
        method: 'POST',
        body: JSON.stringify({ reason: holdReason.trim() }),
      });
      setHoldTarget(null);
      setHoldReason('');
      setNotice('Workflow hold created.');
      setError('');
      await load();
      await loadSummary();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Hold failed.');
    }
  }

  async function releaseHold(caseId: string, holdId: string) {
    try {
      await apiRequest(`/renewal-cases/${caseId}/holds/${holdId}/release`, { method: 'POST' });
      setNotice('Workflow hold released.');
      setError('');
      await load();
      await loadSummary();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Release failed.');
    }
  }

  async function handleDetailChanged() {
    await load();
    await loadSummary();
  }

  const filteredOutbox = outbox.filter((message) => {
    if (outboxStatus && message.status !== outboxStatus) return false;
    if (!outboxSearch) return true;
    const needle = outboxSearch.toLowerCase();
    return (
      message.recipient.toLowerCase().includes(needle) ||
      message.subject.toLowerCase().includes(needle) ||
      customerDisplayName(message.customer).toLowerCase().includes(needle) ||
      message.subscription.name.toLowerCase().includes(needle)
    );
  });

  return (
    <>
      <PageHeading
        title="Renewal operations"
        description="Operational management of subscriptions that have entered the renewal workflow — driven by renewal cases, not a raw subscription list. No email is sent from this screen."
      />
      {!holdTarget && !detailCaseId && (
        <>
          <Notice message={error} />
          <Notice message={notice} tone="success" />
        </>
      )}

      {summary && (
        <section className="metric-grid mb-6">
          {(
            [
              ['Due within 7 days', summary.dueWithin7Days],
              ['Due within 30 days', summary.dueWithin30Days],
              ['Overdue', summary.overdue],
              ['Awaiting customer', summary.awaitingCustomer],
              ['On hold', summary.onHold],
            ] as const
          ).map(([label, value]) => (
            <article className="metric-card" key={label}>
              <p className="text-sm text-[var(--muted)]">{label}</p>
              <p className="mt-3 text-3xl font-semibold">{value}</p>
            </article>
          ))}
        </section>
      )}

      <section className="panel mb-6 grid gap-3 md:grid-cols-4 xl:grid-cols-5">
        <input
          aria-label="Search renewals"
          className="input"
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Customer code/name, subscription code/name"
          value={search}
        />
        <select
          aria-label="Renewal status"
          className="input"
          onChange={(event) => setStatus(event.target.value)}
          value={status}
        >
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
        <select
          aria-label="Hold state"
          className="input"
          onChange={(event) => setHoldStatus(event.target.value)}
          value={holdStatus}
        >
          <option value="">Any hold state</option>
          <option value="ACTIVE">On hold</option>
          <option value="NONE">No active hold</option>
        </select>
        <select
          aria-label="Urgency"
          className="input"
          onChange={(event) => selectUrgency(event.target.value)}
          value={urgency}
        >
          <option value="">Any urgency</option>
          {URGENCY_OPTIONS.map((value) => (
            <option key={value} value={value}>
              {URGENCY_LABEL[value]}
            </option>
          ))}
        </select>
        <select
          aria-label="Service Type filter"
          className="input"
          onChange={(event) => {
            setServiceTypeId(event.target.value);
            setServicePackageId('');
          }}
          value={serviceTypeId}
        >
          <option value="">All service types</option>
          {serviceTypes.map((serviceType) => (
            <option key={serviceType.id} value={serviceType.id}>
              {serviceType.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Package filter"
          className="input"
          onChange={(event) => setServicePackageId(event.target.value)}
          value={servicePackageId}
        >
          <option value="">All packages</option>
          {packages
            .filter((item) => !serviceTypeId || item.serviceTypeId === serviceTypeId)
            .map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
        </select>
        <select
          aria-label="Billing Entity filter"
          className="input"
          onChange={(event) => setBillingEntityId(event.target.value)}
          value={billingEntityId}
        >
          <option value="">All Billing Entities</option>
          {billingEntities.map((entity) => (
            <option key={entity.id} value={entity.id}>
              {entity.name}
            </option>
          ))}
        </select>
        <label className="field">
          <span>Due from</span>
          <input
            aria-label="Due from"
            onChange={(event) => {
              setDueFrom(event.target.value);
              setUrgency('');
            }}
            type="date"
            value={dueFrom}
          />
        </label>
        <label className="field">
          <span>Due to</span>
          <input
            aria-label="Due to"
            onChange={(event) => {
              setDueTo(event.target.value);
              setUrgency('');
            }}
            type="date"
            value={dueTo}
          />
        </label>
        {hasFilters && (
          <button className="button-small" onClick={clearFilters} type="button">
            Clear filters
          </button>
        )}
      </section>

      {holdTarget ? (
        <section className="panel mb-6">
          <h3 className="font-semibold">Create workflow hold</h3>
          <textarea
            className="input mt-3 min-h-24"
            onChange={(event) => setHoldReason(event.target.value)}
            placeholder="Required operational reason"
            value={holdReason}
          />
          <div className="mt-3 flex gap-2">
            <button className="button-primary" onClick={() => void createHold()} type="button">
              Save hold
            </button>
            <button className="button-secondary" onClick={() => setHoldTarget(null)} type="button">
              Cancel
            </button>
          </div>
        </section>
      ) : null}

      <section className="panel overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>Due</th>
              <th>Days</th>
              <th>Customer</th>
              <th>Subscription</th>
              <th>Service / Package</th>
              <th>Amount</th>
              <th>Billing Entity</th>
              <th>Status</th>
              <th>Reminder</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {cases.map((renewalCase) => {
              const activeHold = renewalCase.holds.find(
                (hold) => hold.active && (!hold.expiresAt || new Date(hold.expiresAt) > new Date()),
              );
              const days = asOf ? daysUntilDue(renewalCase.dueDate, asOf) : 0;
              const { subscription } = renewalCase;
              const { customer } = subscription;
              return (
                <tr key={renewalCase.id}>
                  <td>{renewalCase.dueDate.slice(0, 10)}</td>
                  <td className={urgencyOf(days) === 'overdue' ? 'danger' : undefined}>
                    {daysLeftLabel(days)}
                  </td>
                  <td>
                    <Link className="table-link" href={`/dashboard/customers/${customer.id}`}>
                      {customer.customerCode} · {customerDisplayName(customer)}
                    </Link>
                  </td>
                  <td>
                    <Link
                      className="table-link"
                      href={`/dashboard/subscriptions?edit=${subscription.id}`}
                    >
                      {subscription.subscriptionCode}
                    </Link>
                    <p className="text-xs text-[var(--muted)]">{subscription.name}</p>
                  </td>
                  <td>
                    {subscription.serviceType.name}
                    <p className="text-xs text-[var(--muted)]">
                      {subscription.packageNameSnapshot ??
                        subscription.servicePackage?.name ??
                        'Unclassified'}
                    </p>
                  </td>
                  <td>
                    {subscription.sellingPrice} {subscription.currency}
                  </td>
                  <td>{customer.billingEntity.name}</td>
                  <td>
                    <span className="status-pill">{renewalCase.status}</span>
                  </td>
                  <td>
                    {reminderStatusLabel(
                      renewalCase.communicationOutbox[0],
                      renewalCase._count.communicationOutbox,
                    )}
                  </td>
                  <td className="space-x-2 whitespace-nowrap">
                    <button
                      className="link-button"
                      onClick={() => setDetailCaseId(renewalCase.id)}
                      type="button"
                    >
                      View
                    </button>
                    {canHold && !activeHold && (
                      <button
                        className="link-button"
                        onClick={() => setHoldTarget(renewalCase.id)}
                        type="button"
                      >
                        Hold
                      </button>
                    )}
                    {canHold && activeHold && (
                      <button
                        className="link-button"
                        onClick={() => void releaseHold(renewalCase.id, activeHold.id)}
                        type="button"
                      >
                        Release
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!cases.length && (
          <p className="py-8 text-center text-sm text-[var(--muted)]">
            {hasFilters
              ? 'No renewal cases match the selected filters.'
              : 'No subscriptions are currently within the active renewal window.'}
          </p>
        )}
      </section>

      <section className="panel mt-6">
        <button
          className="flex w-full items-center justify-between gap-3 text-left"
          onClick={() => setOutboxOpen((open) => !open)}
          type="button"
        >
          <h3 className="text-lg font-semibold">
            Communication outbox <span className="muted text-sm">({filteredOutbox.length})</span>
          </h3>
          <span className="button-small">{outboxOpen ? 'Hide' : 'Show'}</span>
        </button>
        {outboxOpen && (
          <>
            <p className="muted mt-2 text-xs">
              Secondary/debugging view — for a specific renewal, open its case above instead;
              communication history there is already grouped for you.
            </p>
            <div className="toolbar mt-3">
              <input
                aria-label="Search outbox"
                onChange={(event) => setOutboxSearch(event.target.value)}
                placeholder="Search recipient, subject, customer, subscription"
                value={outboxSearch}
              />
              <select
                aria-label="Outbox status"
                onChange={(event) => setOutboxStatus(event.target.value)}
                value={outboxStatus}
              >
                <option value="">All statuses</option>
                {['QUEUED', 'PROCESSING', 'DELIVERED', 'FAILED', 'CANCELLED'].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </div>
            <div className="table-wrap mt-4 overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Queued</th>
                    <th>Audience</th>
                    <th>Customer / service</th>
                    <th>Recipient</th>
                    <th>Milestone</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOutbox.map((message) => (
                    <tr key={message.id}>
                      <td>{new Date(message.queuedAt).toLocaleString()}</td>
                      <td>{message.audience}</td>
                      <td>
                        {customerDisplayName(message.customer)}
                        <br />
                        <span className="text-xs text-[var(--muted)]">
                          {message.subscription.name}
                        </span>
                      </td>
                      <td>{message.recipient}</td>
                      <td>{message.daysBeforeDue === 0 ? 'D0' : `D-${message.daysBeforeDue}`}</td>
                      <td>{message.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!filteredOutbox.length && (
                <p className="py-8 text-center text-sm text-[var(--muted)]">
                  No communication outbox entries match.
                </p>
              )}
            </div>
          </>
        )}
      </section>

      {detailCaseId && (
        <RenewalCaseDetail
          caseId={detailCaseId}
          onChanged={() => void handleDetailChanged()}
          onClose={() => setDetailCaseId(null)}
        />
      )}
    </>
  );
}
