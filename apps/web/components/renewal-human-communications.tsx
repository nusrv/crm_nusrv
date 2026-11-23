'use client';

import { useEffect, useState } from 'react';
import { apiRequest } from '../lib/api';
import { Notice } from './notice';

type Recipient = { contactId: string | null; email: string; name: string | null; role: string };
type Preview = {
  purpose: 'REMINDER' | 'CLARIFICATION';
  options: Recipient[];
  recipient: string | null;
  recipientContactId: string | null;
  subject: string;
  body: string;
};
type Reply = { id: string; direction: string; subject: string; bodyText: string; occurredAt: string; reviewedAt: string | null };

const reminderStatuses = ['UPCOMING', 'REMINDER_CYCLE', 'AWAITING_CUSTOMER'];

export function RenewalHumanCommunications({
  caseId,
  status,
  clarificationPending,
  canManage,
  onChanged,
}: {
  caseId: string;
  status: string;
  clarificationPending: boolean;
  canManage: boolean;
  onChanged: () => void;
}) {
  const root = `/renewal-cases/${caseId}`;
  const [preview, setPreview] = useState<Preview | null>(null);
  const [replies, setReplies] = useState<Reply[]>([]);
  const [requestKey, setRequestKey] = useState('');
  const [recipientIndex, setRecipientIndex] = useState(-1);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let mounted = true;
    void apiRequest<Reply[]>(`${root}/replies`)
      .then((result) => { if (mounted) setReplies(result); })
      .catch((cause: unknown) => { if (mounted) setError(cause instanceof Error ? cause.message : 'Unable to load replies.'); });
    return () => { mounted = false; };
  }, [root]);

  async function act(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Communication action failed.');
    } finally {
      setBusy(false);
    }
  }

  function compose() {
    void act(async () => {
      const draft = await apiRequest<Preview>(`${root}/reminder-preview`);
      setPreview(draft);
      setSubject(draft.subject);
      setBody(draft.body);
      setRequestKey(crypto.randomUUID());
      setRecipientIndex(draft.options.findIndex((item) =>
        item.contactId === draft.recipientContactId && item.email === draft.recipient));
    });
  }

  function review(path: 'needs-clarification' | 'keep-in-review') {
    void act(async () => {
      await apiRequest(`${root}/${path}`, { method: 'POST' });
      setPreview(null);
      setMessage(path === 'needs-clarification' ? 'Clarification requested. Compose and send it when ready.' : 'Case kept in review.');
      onChanged();
    });
  }

  function send(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!preview) return;
    const recipient = preview.options[recipientIndex];
    if (!recipient) return;
    void act(async () => {
      await apiRequest(`${root}/send-reminder`, {
        method: 'POST',
        body: JSON.stringify({ recipient: recipient.email, recipientContactId: recipient.contactId,
          purpose: preview.purpose, subject, body, idempotencyKey: requestKey }),
      });
      setMessage(preview.purpose === 'CLARIFICATION'
        ? 'Clarification queued. The case moves to Waiting for Customer after SMTP accepts this message.'
        : 'Reminder queued.');
      setPreview(null);
      onChanged();
    });
  }

  const reviewable = reminderStatuses.includes(status) || status === 'HUMAN_REVIEW';
  return (
    <section className="space-y-3">
      <h4 className="font-medium">Customer communication</h4>
      <Notice message={error} />
      <Notice message={message} tone="success" />
      {canManage && reviewable && (
        <div className="flex flex-wrap gap-2">
          {!clarificationPending && <button className="button-small" disabled={busy} onClick={() => review('needs-clarification')} type="button">Needs Clarification</button>}
          <button className="button-small" disabled={busy} onClick={() => review('keep-in-review')} type="button">Keep in Review</button>
          {(reminderStatuses.includes(status) || clarificationPending) && (
            <button className="button-small" disabled={busy} onClick={compose} type="button">
              {clarificationPending ? 'Compose clarification' : 'Compose reminder'}
            </button>
          )}
        </div>
      )}
      {preview && (
        <form className="form-grid" onSubmit={send}>
          <label className="field field-wide">
            <span>Registered recipient</span>
            <select onChange={(event) => setRecipientIndex(Number(event.target.value))} required value={recipientIndex}>
              <option value={-1} disabled>Choose a registered recipient</option>
              {preview.options.map((recipient, index) => (
                <option key={recipient.contactId ?? recipient.email} value={index}>
                  {recipient.email} · {recipient.name ?? recipient.role}
                </option>
              ))}
            </select>
          </label>
          <label className="field field-wide">
            <span>Subject</span>
            <input required maxLength={500} onChange={(event) => setSubject(event.target.value)} value={subject} />
          </label>
          <label className="field field-wide">
            <span>Message</span>
            <textarea required rows={6} onChange={(event) => setBody(event.target.value)} value={body} />
          </label>
          <div className="field-wide flex gap-2">
            <button className="button-primary" disabled={busy || recipientIndex < 0 || !body.trim()} type="submit">Send</button>
            <button className="button-secondary" onClick={() => setPreview(null)} type="button">Cancel</button>
          </div>
        </form>
      )}
      {replies.filter((reply) => reply.direction === 'INBOUND').map((reply) => (
        <article className="rounded border border-[var(--line)] p-3" key={reply.id}>
          <p className="font-medium">{reply.subject}</p>
          <p className="muted text-sm">{new Date(reply.occurredAt).toLocaleString()} · {reply.reviewedAt ? 'Read' : 'Unread'}</p>
          <p className="mt-2 whitespace-pre-wrap text-sm">{reply.bodyText}</p>
          {canManage && (
            <button className="button-small mt-2" disabled={busy} onClick={() => {
              void act(async () => {
                await apiRequest(`${root}/replies/${reply.id}/${reply.reviewedAt ? 'unread' : 'read'}`, { method: 'POST' });
                setReplies(await apiRequest<Reply[]>(`${root}/replies`));
                onChanged();
              });
            }} type="button">{reply.reviewedAt ? 'Mark unread' : 'Mark read'}</button>
          )}
        </article>
      ))}
    </section>
  );
}
