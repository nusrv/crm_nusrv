'use client';

import { workspaceStatus, mailDispatchStatus } from '../lib/workspace-status';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { apiRequest } from '../lib/api';
import { customerDisplayName } from '../lib/customer-name';
import { useControlPanel } from './app-shell';
import { Notice } from './notice';
import { PageHeading } from './page-heading';
import { OutboundEvidenceControls } from './outbound-evidence-controls';

const NON_TERMINAL_DELIVERY = new Set(['QUEUED', 'PROCESSING']);
const POLL_INTERVAL_MS = 4_000;

interface ThreadMessage {
  id: string;
  direction: 'INBOUND' | 'OUTBOUND';
  subject: string;
  fromAddress: string;
  toAddresses: string[];
  bodyText: string;
  occurredAt: string;
  reviewedAt: string | null;
  deliveryStatus: string | null;
  deliveryError: string | null;
  deliveryUncertain: boolean;
  renewalOutboxId: string | null;
  operatorOutboxId: string | null;
}

interface ThreadDetail {
  id: string;
  subject: string;
  status: 'OPEN' | 'HUMAN_REVIEW' | 'RESOLVED';
  lastMessageAt: string;
  customer: { id: string; customerCode: string; nameEn: string | null; nameAr: string | null; primaryEmail: string; status: string } | null;
  mailConfiguration: { id: string; label: string; environment: string; enabled: boolean };
  renewalCase: { id: string; status: string; dueDate: string; subscription: { id: string; subscriptionCode: string; name: string } } | null;
  messages: ThreadMessage[];
}

function newIdempotencyKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

export function CommunicationThreadDetail() {
  const params = useParams<{ threadId: string }>();
  const threadId = params.threadId;
  const { can } = useControlPanel();
  const canReview = can('ADMIN');

  const [thread, setThread] = useState<ThreadDetail | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [replyBody, setReplyBody] = useState('');
  const [replySubject, setReplySubject] = useState('');
  const [sending, setSending] = useState(false);
  const [resolving, setResolving] = useState(false);
  const idempotencyKeyRef = useRef(newIdempotencyKey());
  const [reviewBusy, setReviewBusy] = useState(false);

  const load = useCallback(async () => {
    const result = await apiRequest<ThreadDetail>(`/communication-threads/${threadId}`);
    setThread(result);
    return result;
  }, [threadId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Unable to load thread.'));
  }, [load]);

  // §22 — bounded polling while the most recent outbound message is still QUEUED/PROCESSING;
  // stops on its own once a terminal delivery status is reached.
  useEffect(() => {
    const outbound = thread?.messages.filter((message) => message.direction === 'OUTBOUND');
    const latestOutbound = outbound?.[outbound.length - 1];
    if (!latestOutbound || !NON_TERMINAL_DELIVERY.has(latestOutbound.deliveryStatus ?? '')) return undefined;
    const timer = setInterval(() => {
      void load();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [thread, load]);

  async function sendReply(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!replyBody.trim()) return;
    setSending(true);
    setError('');
    try {
      await apiRequest(`/communication-threads/${threadId}/replies`, {
        method: 'POST',
        body: JSON.stringify({
          idempotencyKey: idempotencyKeyRef.current,
          subject: replySubject.trim() || undefined,
          bodyText: replyBody.trim(),
        }),
      });
      setNotice('Reply queued. Dispatch status will update as evidence is recorded.');
      setReplyBody('');
      setReplySubject('');
      idempotencyKeyRef.current = newIdempotencyKey(); // a fresh key for the NEXT reply only.
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to queue reply.');
    } finally {
      setSending(false);
    }
  }

  async function resolveThread() {
    setResolving(true);
    setError('');
    try {
      await apiRequest(`/communication-threads/${threadId}/resolve`, { method: 'POST' });
      setNotice('Thread marked resolved.');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to resolve thread.');
    } finally {
      setResolving(false);
    }
  }

  async function markRead(message: ThreadMessage) {
    if (reviewBusy) return;
    setReviewBusy(true);
    try {
      await apiRequest(`/communication-threads/${threadId}/messages/${message.id}/${message.reviewedAt ? 'unread' : 'read'}`, { method: 'POST' });
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to update shared read status.'); }
    finally { setReviewBusy(false); }
  }

  if (!thread) {
    return (
      <>
        <PageHeading title="Communication thread" description="Loading…" />
        <Notice message={error} />
      </>
    );
  }

  return (
    <>
      <Link className="table-link" href="/dashboard/communications">
        ← Back to Communication Center
      </Link>
      <PageHeading
        title={thread.subject}
        description={`${thread.customer ? customerDisplayName(thread.customer) || thread.customer.customerCode : 'Unattributed'} · ${thread.mailConfiguration.label} · ${workspaceStatus(thread.status)}`}
        actions={
          canReview && thread.status !== 'RESOLVED' ? (
            <button className="button-secondary" disabled={resolving} onClick={() => void resolveThread()} type="button">
              Resolve thread
            </button>
          ) : undefined
        }
      />
      <Notice message={error} />
      <Notice message={notice} tone="success" />

      <section className="panel">
        <h4 className="font-medium">Context</h4>
        <div className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
          <p>
            <span className="muted">Customer:</span>{' '}
            {thread.customer ? (
              <Link className="table-link" href={`/dashboard/customers/${thread.customer.id}`}>
                {customerDisplayName(thread.customer) || thread.customer.customerCode}
              </Link>
            ) : (
              'Unattributed'
            )}
          </p>
          <p>
            <span className="muted">Mailbox:</span> {thread.mailConfiguration.label} ({thread.mailConfiguration.environment})
          </p>
          <p>
            <span className="muted">Renewal case:</span>{' '}
            {thread.renewalCase ? <Link className="table-link" href={`/dashboard/renewals?case=${thread.renewalCase.id}`}>{thread.renewalCase.subscription.subscriptionCode} · {workspaceStatus(thread.renewalCase.status)}</Link> : '—'}
          </p>
          <p>
            <span className="muted">Thread status:</span> <span className="status-pill">{workspaceStatus(thread.status)}</span>
          </p>
        </div>
      </section>

      <section className="panel mt-6">
        <h4 className="font-medium">Conversation</h4>
        <div className="mt-3 space-y-4">
          {thread.messages.map((message) => (
            <div className="rounded-lg border border-[var(--line)] p-3 text-sm" key={message.id}>
              <div className="flex flex-wrap justify-between gap-2"><strong>{message.direction === 'INBOUND' ? 'Inbound' : 'Outbound'} · {message.fromAddress} → {message.toAddresses.join(', ')}</strong><span className="muted">{new Date(message.occurredAt).toLocaleString()}</span></div>
              <p className="mt-2 whitespace-pre-wrap">{message.bodyText}</p>
              {message.direction === 'INBOUND' && <p>{message.reviewedAt ? 'Read' : 'Unread'} {canReview && <button className="button-small" type="button" disabled={reviewBusy} onClick={() => void markRead(message)}>{message.reviewedAt ? 'Mark unread' : 'Mark read'}</button>}</p>}
              {message.deliveryStatus && <p>{mailDispatchStatus(message.deliveryStatus, message.deliveryUncertain)}</p>}
              {message.deliveryError && <p className="danger">{message.deliveryError}</p>}
              {canReview && message.operatorOutboxId && <OutboundEvidenceControls path={`/communication-threads/${threadId}/outbox/${message.operatorOutboxId}`} onChanged={() => void load().catch(() => undefined)} />}
              {canReview && message.renewalOutboxId && thread.renewalCase && <OutboundEvidenceControls path={`/renewal-cases/${thread.renewalCase.id}/outbox/${message.renewalOutboxId}`} onChanged={() => void load().catch(() => undefined)} />}
            </div>
          ))}
        </div>
      </section>

      {canReview && (
        <section className="panel mt-6">
          <h4 className="font-medium">Reply</h4>
          <p className="muted text-sm">Write and review your reply manually. No AI is active.</p>
          <form className="form-grid mt-3" onSubmit={(event) => void sendReply(event)}>
            <label className="field field-wide">
              <span>Subject (optional — defaults to &quot;Re: {thread.subject}&quot;)</span>
              <input onChange={(event) => setReplySubject(event.target.value)} value={replySubject} />
            </label>
            <label className="field field-wide">
              <span>Message</span>
              <textarea onChange={(event) => setReplyBody(event.target.value)} rows={6} value={replyBody} />
            </label>
            <div className="field-wide flex gap-3">
              <button className="button-primary" disabled={sending || !replyBody.trim()} type="submit">
                {sending ? 'Sending…' : 'Send reply'}
              </button>
            </div>
          </form>
        </section>
      )}
    </>
  );
}

