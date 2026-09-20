'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { apiRequest } from '../lib/api';
import { customerDisplayName } from '../lib/customer-name';
import { useControlPanel } from './app-shell';
import { Notice } from './notice';
import { PageHeading } from './page-heading';

const AI_INTENTS = [
  'ACCEPT_RENEWAL',
  'REJECT_RENEWAL',
  'REQUEST_INVOICE',
  'PAYMENT_REPORTED',
  'REQUEST_UPGRADE',
  'REQUEST_DOWNGRADE',
  'REQUEST_CLARIFICATION',
  'PRICE_DISPUTE',
  'COMPLAINT',
  'OTHER',
  'UNCLEAR',
];

const NON_TERMINAL_DELIVERY = new Set(['QUEUED', 'PROCESSING']);
const POLL_INTERVAL_MS = 4_000;

interface EffectiveClassification {
  source: 'AI' | 'HUMAN_REVIEW';
  effectiveIntent: string;
  effectiveResult: { confidence?: number; summary?: string; language?: string } | null;
  aiClassificationId: string;
  createdAt: string;
}

interface ThreadMessage {
  id: string;
  direction: 'INBOUND' | 'OUTBOUND';
  subject: string;
  fromAddress: string;
  toAddresses: string[];
  bodyText: string;
  occurredAt: string;
  classificationStatus: string | null;
  deliveryStatus: string | null;
  deliveryError: string | null;
  effectiveClassification: EffectiveClassification | null;
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

interface DraftReplyResult {
  subject: string;
  bodyText: string;
  language: string;
  schemaVersion: string;
}

// Maps the safe operator-facing error codes AiReplyDraftService/AiReplyDraftService's controller
// throw into a friendlier sentence. Falls back to the raw server message for anything unrecognized
// (never invents a misleading message for an error shape this component doesn't know about).
const DRAFT_ERROR_MESSAGES: Record<string, string> = {
  AI_ASSISTANCE_DISABLED: 'AI assistance is currently disabled for this environment.',
  NO_INBOUND_MESSAGE_TO_REPLY_TO: 'There is no customer message in this thread to draft a reply to.',
  AI_ASSISTANCE_TEMPORARILY_UNAVAILABLE: 'AI assistance is temporarily unavailable. Please try again shortly.',
  AI_ASSISTANCE_UNAVAILABLE: 'AI assistance is currently unavailable.',
  AI_DRAFT_GENERATION_FAILED: 'Unable to generate a suggested reply right now. You can still write one manually.',
};

function friendlyDraftError(message: string): string {
  return DRAFT_ERROR_MESSAGES[message] ?? message;
}

export function CommunicationThreadDetail() {
  const params = useParams<{ threadId: string }>();
  const threadId = params.threadId;
  const { can } = useControlPanel();
  const canReview = can('ADMIN', 'SALES_DEVELOPMENT');

  const [thread, setThread] = useState<ThreadDetail | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [replyBody, setReplyBody] = useState('');
  const [replySubject, setReplySubject] = useState('');
  const [sending, setSending] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [generatingDraft, setGeneratingDraft] = useState(false);
  const idempotencyKeyRef = useRef(newIdempotencyKey());
  const [reviewOpenFor, setReviewOpenFor] = useState<string | null>(null);
  const [reviewIntent, setReviewIntent] = useState('ACCEPT_RENEWAL');
  const [reviewNotes, setReviewNotes] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);

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
      setNotice('Reply queued. Delivery status will update automatically.');
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

  // §19 — explicit button click only, never auto-triggered. Never silently overwrites text the
  // operator has already typed; the generated result only ever populates the composer, and the
  // operator retains full edit control and must still press the existing Send button.
  async function generateDraft() {
    if (replyBody.trim() && !window.confirm('Replace your current draft with an AI-suggested reply?')) {
      return;
    }
    setGeneratingDraft(true);
    setError('');
    try {
      const result = await apiRequest<DraftReplyResult>(`/communication-threads/${threadId}/draft-reply`, { method: 'POST' });
      setReplySubject(result.subject);
      setReplyBody(result.bodyText);
      setNotice('Suggested reply generated. Review and edit before sending.');
    } catch (cause) {
      setError(cause instanceof Error ? friendlyDraftError(cause.message) : 'Unable to generate a suggested reply.');
    } finally {
      setGeneratingDraft(false);
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

  async function submitReview(messageId: string, classificationId: string) {
    setSubmittingReview(true);
    setError('');
    try {
      await apiRequest(`/email-messages/${messageId}/classifications/${classificationId}/reviews`, {
        method: 'POST',
        body: JSON.stringify({ correctedIntent: reviewIntent, notes: reviewNotes.trim() || undefined }),
      });
      setNotice('Classification correction saved.');
      setReviewOpenFor(null);
      setReviewNotes('');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save classification correction.');
    } finally {
      setSubmittingReview(false);
    }
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
        description={`${thread.customer ? customerDisplayName(thread.customer) || thread.customer.customerCode : 'Unattributed'} · ${thread.mailConfiguration.label} · ${thread.status}`}
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
            {thread.renewalCase ? `${thread.renewalCase.subscription.subscriptionCode} · ${thread.renewalCase.status}` : '—'}
          </p>
          <p>
            <span className="muted">Thread status:</span> <span className="status-pill">{thread.status}</span>
          </p>
        </div>
      </section>

      <section className="panel mt-6">
        <h4 className="font-medium">Conversation</h4>
        <div className="mt-3 space-y-4">
          {thread.messages.map((message) => (
            <MessageBubble
              canReview={canReview}
              key={message.id}
              message={message}
              onOpenReview={() => {
                setReviewOpenFor(message.id);
                setReviewIntent(message.effectiveClassification?.effectiveIntent ?? 'ACCEPT_RENEWAL');
              }}
              onSubmitReview={() =>
                message.effectiveClassification && void submitReview(message.id, message.effectiveClassification.aiClassificationId)
              }
              onReviewIntentChange={setReviewIntent}
              onReviewNotesChange={setReviewNotes}
              reviewIntent={reviewIntent}
              reviewNotes={reviewNotes}
              reviewOpen={reviewOpenFor === message.id}
              submittingReview={submittingReview}
            />
          ))}
        </div>
      </section>

      {canReview && (
        <section className="panel mt-6">
          <h4 className="font-medium">Reply</h4>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              className="button-secondary"
              disabled={generatingDraft}
              onClick={() => void generateDraft()}
              type="button"
            >
              {generatingDraft ? 'Generating…' : 'Generate Suggested Reply'}
            </button>
            <span className="muted text-xs">AI drafts a suggestion only — you review, edit, and press Send.</span>
          </div>
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

function MessageBubble({
  message,
  canReview,
  reviewOpen,
  onOpenReview,
  onSubmitReview,
  reviewIntent,
  onReviewIntentChange,
  reviewNotes,
  onReviewNotesChange,
  submittingReview,
}: {
  message: ThreadMessage;
  canReview: boolean;
  reviewOpen: boolean;
  onOpenReview: () => void;
  onSubmitReview: () => void;
  reviewIntent: string;
  onReviewIntentChange: (value: string) => void;
  reviewNotes: string;
  onReviewNotesChange: (value: string) => void;
  submittingReview: boolean;
}) {
  const isInbound = message.direction === 'INBOUND';
  const needsAttention = message.classificationStatus === 'HUMAN_REVIEW';
  return (
    <div
      className="rounded-lg border p-3 text-sm"
      style={{ borderColor: needsAttention ? 'var(--danger)' : 'var(--line)', background: isInbound ? 'var(--surface)' : 'white' }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">
          {isInbound ? '← Inbound' : '→ Outbound'} · {message.fromAddress} → {message.toAddresses.join(', ')}
        </span>
        <span className="muted text-xs">{new Date(message.occurredAt).toLocaleString()}</span>
      </div>
      <p className="mt-2 whitespace-pre-wrap">{message.bodyText}</p>
      <div className="mt-2 flex flex-wrap gap-2 text-xs">
        {message.classificationStatus && (
          <span className={`status-pill ${needsAttention ? 'danger' : ''}`}>
            Classification: {message.classificationStatus}
          </span>
        )}
        {message.deliveryStatus && <span className="status-pill">Delivery: {message.deliveryStatus}</span>}
      </div>
      {message.effectiveClassification && (
        <div className="mt-2 rounded-lg border border-[var(--line)] bg-white p-2 text-xs">
          <p>
            <span className="muted">Effective classification ({message.effectiveClassification.source}):</span>{' '}
            <strong>{message.effectiveClassification.effectiveIntent}</strong>
            {message.effectiveClassification.source === 'AI' &&
              typeof message.effectiveClassification.effectiveResult?.confidence === 'number' && (
                <> · confidence {(message.effectiveClassification.effectiveResult.confidence * 100).toFixed(0)}% (not a business decision)</>
              )}
          </p>
          {message.effectiveClassification.effectiveResult?.summary && (
            <p className="muted mt-1">{message.effectiveClassification.effectiveResult.summary}</p>
          )}
          {canReview && !reviewOpen && (
            <button className="button-small mt-2" onClick={onOpenReview} type="button">
              Correct classification
            </button>
          )}
          {reviewOpen && (
            <div className="mt-2 space-y-2">
              <select onChange={(event) => onReviewIntentChange(event.target.value)} value={reviewIntent}>
                {AI_INTENTS.map((intent) => (
                  <option key={intent} value={intent}>
                    {intent}
                  </option>
                ))}
              </select>
              <textarea
                onChange={(event) => onReviewNotesChange(event.target.value)}
                placeholder="Notes (optional)"
                rows={2}
                value={reviewNotes}
              />
              <div className="flex gap-2">
                <button className="button-small" disabled={submittingReview} onClick={onSubmitReview} type="button">
                  Save correction
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {message.deliveryError && <p className="mt-2 text-xs" style={{ color: 'var(--danger)' }}>{message.deliveryError}</p>}
    </div>
  );
}
