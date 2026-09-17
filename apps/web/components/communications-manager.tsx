'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { apiRequest, type PageResult } from '../lib/api';
import { customerDisplayName } from '../lib/customer-name';
import { Notice } from './notice';
import { PageHeading } from './page-heading';

interface ThreadListItem {
  id: string;
  subject: string;
  status: 'OPEN' | 'HUMAN_REVIEW' | 'RESOLVED';
  renewalCaseId: string | null;
  lastMessageAt: string;
  customer: { id: string; customerCode: string; nameEn: string | null; nameAr: string | null; primaryEmail: string } | null;
  mailConfiguration: { id: string; label: string };
  latestMessage: { direction: 'INBOUND' | 'OUTBOUND'; preview: string; occurredAt: string } | null;
  pendingHumanReviewCount: number;
  requiresAttention: boolean;
}

const STATUS_OPTIONS = ['OPEN', 'HUMAN_REVIEW', 'RESOLVED'];

export function CommunicationsManager() {
  const [threads, setThreads] = useState<ThreadListItem[]>([]);
  const [meta, setMeta] = useState<PageResult<ThreadListItem>['meta'] | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page), pageSize: '20' });
    if (search) params.set('search', search);
    if (status) params.set('status', status);
    if (attentionOnly) params.set('attention', 'true');
    const result = await apiRequest<PageResult<ThreadListItem>>(`/communication-threads?${params.toString()}`);
    setThreads(result.data);
    setMeta(result.meta);
  }, [page, search, status, attentionOnly]);

  useEffect(() => {
    void load().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Unable to load communication threads.'));
  }, [load]);

  return (
    <>
      <PageHeading
        title="Communication Center"
        description="Customer email threads — inbound/outbound history, AI classification, and human review."
      />
      <Notice message={error} />
      <section className="panel">
        <div className="toolbar">
          <input
            onChange={(event) => {
              setPage(1);
              setSearch(event.target.value);
            }}
            placeholder="Search subject or customer…"
            value={search}
          />
          <select
            onChange={(event) => {
              setPage(1);
              setStatus(event.target.value);
            }}
            value={status}
          >
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <label className="checkbox">
            <input
              checked={attentionOnly}
              onChange={(event) => {
                setPage(1);
                setAttentionOnly(event.target.checked);
              }}
              type="checkbox"
            />
            Requires attention only
          </label>
        </div>
        <div className="table-wrap mt-4">
          <table className="data-table">
            <thead>
              <tr>
                <th>Subject</th>
                <th>Customer</th>
                <th>Last activity</th>
                <th>Status</th>
                <th>Attention</th>
              </tr>
            </thead>
            <tbody>
              {threads.map((thread) => (
                <tr key={thread.id}>
                  <td>
                    <Link className="table-link" href={`/dashboard/communications/${thread.id}`}>
                      {thread.subject}
                    </Link>
                    {thread.latestMessage && (
                      <div className="muted text-xs">
                        {thread.latestMessage.direction === 'INBOUND' ? '← ' : '→ '}
                        {thread.latestMessage.preview}
                      </div>
                    )}
                  </td>
                  <td>
                    {thread.customer ? (
                      customerDisplayName(thread.customer) || thread.customer.customerCode
                    ) : (
                      <span className="muted">Unattributed</span>
                    )}
                  </td>
                  <td>{new Date(thread.lastMessageAt).toLocaleString()}</td>
                  <td>
                    <span className="status-pill">{thread.status}</span>
                  </td>
                  <td>
                    {thread.requiresAttention ? (
                      <span className="status-pill danger">
                        Needs review{thread.pendingHumanReviewCount > 0 ? ` (${thread.pendingHumanReviewCount})` : ''}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
              {!threads.length && (
                <tr>
                  <td className="muted" colSpan={5}>
                    No communication threads match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {meta && (
          <div className="pagination">
            <span>
              Page {meta.page} of {Math.max(meta.pageCount, 1)} · {meta.total} threads
            </span>
            <button disabled={meta.page <= 1} onClick={() => setPage((current) => current - 1)} type="button">
              Previous
            </button>
            <button disabled={meta.page >= meta.pageCount} onClick={() => setPage((current) => current + 1)} type="button">
              Next
            </button>
          </div>
        )}
      </section>
    </>
  );
}
