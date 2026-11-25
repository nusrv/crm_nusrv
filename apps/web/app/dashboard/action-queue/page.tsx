'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useControlPanel } from '../../../components/app-shell';
import { PageHeading } from '../../../components/page-heading';
import { Notice } from '../../../components/notice';
import { apiRequest } from '../../../lib/api';

type Lane = 'FOLLOW_UP' | 'UNCERTAIN_COMMUNICATION' | 'UNCERTAIN_REPLY';
type QueueItem = {
  id: string; recipient: string; status: string; createdAt: string; lastAttemptAt?: string | null;
  subjectType?: string; subjectId?: string; attemptId?: string; originalMessageId?: string; revision?: number;
  resolutionReason?: string | null; resolvedById?: string | null; resolvedAt?: string | null;
  mailConfiguration?: { label: string }; _count?: { observations: number };
  observations?: { id: string; folder: string; enhancedStatus: string; createdAt: string }[];
  renewalCaseId?: string; threadId?: string; resendOfId?: string | null;
};
type Result = { enabled: boolean; items: QueueItem[]; hasMore: boolean };

export default function ActionQueuePage() {
  const { can } = useControlPanel();
  const admin = can('ADMIN');
  const [lane, setLane] = useState<Lane>('FOLLOW_UP');
  const [status, setStatus] = useState<'OPEN' | 'RESOLVED'>('OPEN');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [selection, setSelection] = useState<QueueItem | null>(null);
  const [reason, setReason] = useState('');
  const request = useRef(0);

  const load = useCallback(async () => {
    if (!admin) return;
    const generation = ++request.current;
    try {
      const data = await apiRequest<Result>('/mail/action-queue?' + new URLSearchParams({ lane, status, page: String(page) }));
      if (request.current === generation) { setResult(data); setError(''); }
    } catch (cause) {
      if (request.current === generation) { setResult(null); setError(cause instanceof Error ? cause.message : 'Unable to load action queue.'); }
    }
  }, [admin, lane, page, status]);

  useEffect(() => {
    void load();
    return () => { request.current += 1; };
  }, [load]);

  async function closeTask() {
    if (!selection || !reason.trim() || selection.revision === undefined || busy) return;
    setBusy(true); setError('');
    try {
      await apiRequest('/mail/action-queue/resolve', { method: 'POST', body: JSON.stringify({
        taskId: selection.id, expectedRevision: selection.revision, reason: reason.trim(),
      }) });
      setSelection(null); setReason(''); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to resolve task.'); }
    finally { setBusy(false); }
  }

  if (!admin) return <Notice message="ADMIN access required." />;
  return <>
    <PageHeading eyebrow="Communications" title="Action / Error Queue"
      description="Review recorded delivery evidence and uncertain SMTP attempts. Resolving a follow-up records your review only; it does not send email or change a renewal decision."
      actions={<Link className="button-secondary" href="/dashboard/communications">Communication Center</Link>} />
    <Notice message={error} />
    {result?.enabled === false ? <section className="panel">Action queue is inactive pending release validation.</section> :
      <section className="panel">
        <div className="toolbar">
          <select aria-label="Evidence lane" disabled={busy || selection !== null} value={lane}
            onChange={e => { setResult(null); setLane(e.target.value as Lane); setPage(1); }}>
            <option value="FOLLOW_UP">Corroborated DSN follow-ups</option>
            <option value="UNCERTAIN_COMMUNICATION">Uncertain renewal communication</option>
            <option value="UNCERTAIN_REPLY">Uncertain operator replies</option>
          </select>
          {lane === 'FOLLOW_UP' && <select aria-label="Task status" disabled={busy || selection !== null} value={status}
            onChange={e => { setResult(null); setStatus(e.target.value as 'OPEN' | 'RESOLVED'); setPage(1); }}>
            <option value="OPEN">Open</option><option value="RESOLVED">Resolved</option>
          </select>}
          <button type="button" className="button-secondary" disabled={busy || selection !== null} onClick={() => void load()}>Refresh</button>
        </div>
        {lane !== 'FOLLOW_UP' && <p className="muted mt-3">An uncertain attempt is not proof of delivery or failure. Review its original communication before using the separate warned manual resend workflow.</p>}
        <div className="table-wrap mt-4"><table className="data-table">
          <thead><tr><th>Recipient / recorded identity</th><th>Evidence / status</th><th>Action</th></tr></thead>
          <tbody>{result?.items.map(item => <tr key={item.id}>
            <td><strong>{item.recipient}</strong><div className="muted text-xs">{item.mailConfiguration?.label ?? item.id}</div>
              {item.subjectId && <div className="muted text-xs">{item.subjectType}: {item.subjectId}</div>}
              {item.attemptId && <div className="muted text-xs">Attempt: {item.attemptId}</div>}
              {item.originalMessageId && <div className="muted text-xs break-all">{item.originalMessageId}</div>}
            </td>
            <td>{item.status}<div className="muted text-xs">{new Date(item.lastAttemptAt ?? item.createdAt).toLocaleString()}</div>
              {item._count && <div>{item._count.observations} observation(s)</div>}
              {item.observations?.map(o => <div className="muted text-xs" key={o.id}>{o.enhancedStatus} · {o.folder} · {new Date(o.createdAt).toLocaleString()}</div>)}
              {item.resolutionReason && <div>{item.resolutionReason}</div>}
              {item.resolvedById && <div className="muted text-xs">Resolved by {item.resolvedById} {item.resolvedAt && new Date(item.resolvedAt).toLocaleString()}</div>}
            </td>
            <td>{lane === 'FOLLOW_UP' && item.status === 'OPEN' ?
              <button type="button" disabled={busy || selection !== null} className="button-secondary" onClick={() => { setSelection(item); setReason(''); }}>Review / resolve</button> :
              item.threadId ? <Link href={'/dashboard/communications/' + item.threadId} className="table-link">Open thread</Link> :
              item.renewalCaseId ? <Link href="/dashboard/renewals" className="table-link">Renewals ({item.renewalCaseId})</Link> : '—'}</td>
          </tr>)}</tbody>
        </table></div>
        {!result ? <p className="muted mt-4">{error ? 'Unable to load results.' : 'Loading…'}</p> : result.items.length === 0 && <p className="muted mt-4">No recorded items in this lane.</p>}
        <div className="toolbar mt-4">
          <button type="button" className="button-secondary" disabled={page === 1 || busy || selection !== null} onClick={() => { setResult(null); setPage(p => p - 1); }}>Previous</button>
          <span>Page {page}</span>
          <button type="button" className="button-secondary" disabled={!result?.hasMore || page >= 400 || busy || selection !== null} onClick={() => { setResult(null); setPage(p => p + 1); }}>Next</button>
        </div>
      </section>}
    {selection && <section className="panel mt-4">
      <h3 className="font-semibold">Resolve follow-up for {selection.recipient}</h3>
      <p className="muted mt-2">Confirm only after reviewing the recorded evidence. This does not resend any email.</p>
      <label className="block mt-3">Resolution reason<input className="w-full" maxLength={500} value={reason} disabled={busy} onChange={e => setReason(e.target.value)} /></label>
      <div className="toolbar mt-3">
        <button type="button" className="button-primary" disabled={busy || !reason.trim()} onClick={() => void closeTask()}>{busy ? 'Saving…' : 'Resolve follow-up'}</button>
        <button type="button" className="button-secondary" disabled={busy} onClick={() => { setSelection(null); setReason(''); }}>Cancel</button>
      </div>
    </section>}
  </>;
}
