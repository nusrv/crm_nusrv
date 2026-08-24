'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiRequest, type PageResult } from '../lib/api';
import { Notice } from './notice';
import { PageHeading } from './page-heading';
import { useControlPanel } from './app-shell';

interface RenewalHold {
  id: string;
  reason: string;
  active: boolean;
  expiresAt?: string | null;
  stopsCustomerReminders: boolean;
  stopsInternalNotifications: boolean;
}

interface RenewalCase {
  id: string;
  dueDate: string;
  status: string;
  subscription: {
    id: string;
    subscriptionCode: string;
    name: string;
    customer: { companyName: string };
    serviceType: { name: string };
  };
  holds: RenewalHold[];
  _count: { communicationOutbox: number };
}

interface ServiceTypeOption {
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
  customer: { companyName: string };
  subscription: { name: string };
}

export function RenewalCasesManager() {
  const { can } = useControlPanel();
  const [cases, setCases] = useState<RenewalCase[]>([]);
  const [outbox, setOutbox] = useState<OutboxMessage[]>([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [holdStatus, setHoldStatus] = useState('');
  const [serviceTypeId, setServiceTypeId] = useState('');
  const [daysBeforeDue, setDaysBeforeDue] = useState('');
  const [serviceTypes, setServiceTypes] = useState<ServiceTypeOption[]>([]);
  const [dueFrom, setDueFrom] = useState('');
  const [dueTo, setDueTo] = useState('');
  const [holdTarget, setHoldTarget] = useState<string | null>(null);
  const [holdReason, setHoldReason] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    const params = new URLSearchParams({ pageSize: '50' });
    if (search) params.set('search', search);
    if (status) params.set('status', status);
    if (holdStatus) params.set('holdStatus', holdStatus);
    if (serviceTypeId) params.set('serviceTypeId', serviceTypeId);
    if (daysBeforeDue) params.set('daysBeforeDue', daysBeforeDue);
    if (dueFrom) params.set('dueFrom', dueFrom);
    if (dueTo) params.set('dueTo', dueTo);
    const [caseResult, outboxResult, serviceTypeResult] = await Promise.all([
      apiRequest<PageResult<RenewalCase>>(`/renewal-cases?${params}`),
      apiRequest<PageResult<OutboxMessage>>('/communication-outbox?pageSize=25'),
      apiRequest<PageResult<ServiceTypeOption>>('/service-types?pageSize=100'),
    ]);
    setCases(caseResult.data);
    setOutbox(outboxResult.data);
    setServiceTypes(serviceTypeResult.data);
  }, [daysBeforeDue, dueFrom, dueTo, holdStatus, search, serviceTypeId, status]);

  useEffect(() => {
    void load().catch((error: unknown) =>
      setNotice(error instanceof Error ? error.message : 'Unable to load renewals.'),
    );
  }, [load]);

  async function createHold() {
    if (!holdTarget || !holdReason.trim()) return;
    await apiRequest(`/renewal-cases/${holdTarget}/holds`, {
      method: 'POST',
      body: JSON.stringify({ reason: holdReason.trim() }),
    });
    setHoldTarget(null);
    setHoldReason('');
    setNotice('Workflow hold created.');
    await load();
  }

  async function releaseHold(caseId: string, holdId: string) {
    await apiRequest(`/renewal-cases/${caseId}/holds/${holdId}/release`, { method: 'POST' });
    setNotice('Workflow hold released.');
    await load();
  }

  const canHold = can('ADMIN', 'ACCOUNTANT', 'IT', 'SALES_DEVELOPMENT');

  return (
    <>
      <PageHeading
        title="Renewal operations"
        description="Renewal cases, workflow holds, and the durable Phase 2 communication outbox. No email is sent from this screen."
      />
      <Notice message={notice} />
      <section className="panel mb-6 grid gap-3 md:grid-cols-4 xl:grid-cols-7">
        <input
          className="input"
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Customer or subscription"
          value={search}
        />
        <select
          className="input"
          onChange={(event) => setStatus(event.target.value)}
          value={status}
        >
          <option value="">All statuses</option>
          {[
            'UPCOMING',
            'REMINDER_CYCLE',
            'AWAITING_CUSTOMER',
            'HUMAN_REVIEW',
            'ACCEPTED',
            'REJECTED',
            'FULFILLED',
            'CLOSED',
            'ERROR',
          ].map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
        <select
          className="input"
          onChange={(event) => setHoldStatus(event.target.value)}
          value={holdStatus}
        >
          <option value="">Any hold state</option>
          <option value="ACTIVE">On hold</option>
          <option value="NONE">No active hold</option>
        </select>
        <select
          className="input"
          onChange={(event) => setServiceTypeId(event.target.value)}
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
          className="input"
          onChange={(event) => setDaysBeforeDue(event.target.value)}
          value={daysBeforeDue}
        >
          <option value="">Any urgency</option>
          {[30, 21, 14, 7, 2, 0].map((days) => (
            <option key={days} value={days}>
              {days === 0 ? 'Expires today' : `D-${days}`}
            </option>
          ))}
        </select>
        <input
          className="input"
          onChange={(event) => setDueFrom(event.target.value)}
          type="date"
          value={dueFrom}
        />
        <input
          className="input"
          onChange={(event) => setDueTo(event.target.value)}
          type="date"
          value={dueTo}
        />
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
              <th>Customer / subscription</th>
              <th>Service</th>
              <th>Status</th>
              <th>Hold</th>
              <th>Queued</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {cases.map((renewalCase) => {
              const activeHold = renewalCase.holds.find(
                (hold) => hold.active && (!hold.expiresAt || new Date(hold.expiresAt) > new Date()),
              );
              return (
                <tr key={renewalCase.id}>
                  <td>{renewalCase.dueDate.slice(0, 10)}</td>
                  <td>
                    <p className="font-medium">{renewalCase.subscription.customer.companyName}</p>
                    <p className="text-xs text-[var(--muted)]">{renewalCase.subscription.name}</p>
                  </td>
                  <td>{renewalCase.subscription.serviceType.name}</td>
                  <td>{renewalCase.status}</td>
                  <td>{activeHold ? activeHold.reason : '—'}</td>
                  <td>{renewalCase._count.communicationOutbox}</td>
                  <td>
                    {canHold && !activeHold ? (
                      <button
                        className="link-button"
                        onClick={() => setHoldTarget(renewalCase.id)}
                        type="button"
                      >
                        Hold
                      </button>
                    ) : null}
                    {canHold && activeHold ? (
                      <button
                        className="link-button"
                        onClick={() => void releaseHold(renewalCase.id, activeHold.id)}
                        type="button"
                      >
                        Release
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!cases.length ? (
          <p className="py-8 text-center text-sm text-[var(--muted)]">
            No renewal cases match the filters.
          </p>
        ) : null}
      </section>

      <section className="panel mt-6 overflow-x-auto">
        <h3 className="mb-4 text-lg font-semibold">Communication outbox</h3>
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
            {outbox.map((message) => (
              <tr key={message.id}>
                <td>{new Date(message.queuedAt).toLocaleString()}</td>
                <td>{message.audience}</td>
                <td>
                  {message.customer.companyName}
                  <br />
                  <span className="text-xs text-[var(--muted)]">{message.subscription.name}</span>
                </td>
                <td>{message.recipient}</td>
                <td>{message.daysBeforeDue === 0 ? 'D0' : `D-${message.daysBeforeDue}`}</td>
                <td>{message.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
