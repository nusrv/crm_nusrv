'use client';

import { useEffect, useState } from 'react';
import { apiRequest } from '../lib/api';
import { Notice } from './notice';
import { PageHeading } from './page-heading';

interface DashboardData {
  activeCustomers: number;
  totalSubscriptions: number;
  awaitingLegacyReview: number;
  activeTechnicalConnections: number;
  awaitingCustomer: number;
  renewalCasesOnHold: number;
  queuedReminders: number;
  failedOrStuckOutbox: number;
  renewalWindows: {
    within30: number;
    within21: number;
    within14: number;
    within7: number;
    within2: number;
    expiresToday: number;
  };
  subscriptionsByServiceType: Array<{
    serviceType?: { id: string; code: string; name: string };
    count: number;
  }>;
  businessTimezone: string;
  businessDate: string;
  asOf: string;
}

export function DashboardSummary() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    void apiRequest<DashboardData>('/dashboard')
      .then(setData)
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'Unable to load dashboard.');
      });
  }, []);

  return (
    <>
      <PageHeading
        title="Operational dashboard"
        description="Renewal windows use the configured business timezone. Queue counts represent durable outbox records; Phase 2 does not send email."
      />
      <Notice message={error} />
      {!data ? (
        <p className="text-sm text-[var(--muted)]">Loading dashboard data…</p>
      ) : (
        <>
          <p className="mb-4 text-sm text-[var(--muted)]">
            Business date {data.businessDate} · {data.businessTimezone}
          </p>
          <section className="metric-grid">
            {[
              ['Renewals ≤30 days', data.renewalWindows.within30],
              ['Renewals ≤21 days', data.renewalWindows.within21],
              ['Renewals ≤14 days', data.renewalWindows.within14],
              ['Renewals ≤7 days', data.renewalWindows.within7],
              ['Renewals ≤2 days', data.renewalWindows.within2],
              ['Expires today', data.renewalWindows.expiresToday],
              ['Awaiting customer', data.awaitingCustomer],
              ['Cases on hold', data.renewalCasesOnHold],
              ['Queued reminders', data.queuedReminders],
              ['Failed / stuck outbox', data.failedOrStuckOutbox],
              ['Active customers', data.activeCustomers],
              ['Subscriptions', data.totalSubscriptions],
            ].map(([label, value]) => (
              <article className="metric-card" key={label}>
                <p className="text-sm text-[var(--muted)]">{label}</p>
                <p className="mt-3 text-3xl font-semibold">{value}</p>
              </article>
            ))}
          </section>
          <section className="panel mt-6">
            <h3 className="text-lg font-semibold">Operational context</h3>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-[var(--line)] p-4">
                Legacy review: {data.awaitingLegacyReview}
              </div>
              <div className="rounded-xl border border-[var(--line)] p-4">
                Active technical connections: {data.activeTechnicalConnections}
              </div>
              <div className="rounded-xl border border-[var(--line)] p-4">
                Service types represented: {data.subscriptionsByServiceType.length}
              </div>
            </div>
          </section>
        </>
      )}
    </>
  );
}
