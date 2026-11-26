'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiRequest } from '../lib/api';
import { Notice } from './notice';

type Recipient = { contactId: string | null; email: string; name: string | null; role: string };
type Preview = {
  purpose: 'REMINDER' | 'CLARIFICATION';
  communicationRevision: number;
  options: Recipient[];
  recipient: string | null;
  recipientContactId: string | null;
  subject: string;
  body: string;
  customerId: string;
  service: string;
  dueDate: string;
  termMonths: number | null;
  amount: string;
  currency: string;
};
type Reply = { id: string; direction: string; subject: string; bodyText: string; fromAddress: string; occurredAt: string; reviewedAt: string | null };

const reminderStatuses = ['UPCOMING', 'REMINDER_CYCLE', 'AWAITING_CUSTOMER'];

export function RenewalHumanCommunications({
  caseId,
  status,
  communicationRevision,
  clarificationPending,
  canManage,
  onChanged,
  prepareOnOpen = false,
}: {
  caseId: string;
  status: string;
  communicationRevision: number;
  clarificationPending: boolean;
  canManage: boolean;
  onChanged: () => Promise<void>;
  prepareOnOpen?: boolean;
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

  useEffect(() => {
    if (!prepareOnOpen || !canManage) return;
    let mounted = true;
    void apiRequest<Preview>(`${root}/reminder-preview`).then((draft) => {
      if (!mounted) return;
      setPreview(draft); setSubject(draft.subject); setBody(draft.body);
      setRequestKey(crypto.randomUUID());
      setRecipientIndex(draft.options.findIndex((item) => item.contactId === draft.recipientContactId && item.email === draft.recipient));
    }).catch((cause: unknown) => { if (mounted) setError(cause instanceof Error ? cause.message : 'Unable to prepare reminder.'); });
    return () => { mounted = false; };
  }, [root, prepareOnOpen, canManage]);

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

  function review(path: 'needs-clarification' | 'keep-in-review' | 'mark-accepted' | 'mark-do-not-renew', messageId: string) {
    void act(async () => {
      await apiRequest(`${root}/${path}`, { method: 'POST', body: JSON.stringify({ messageId, expectedRevision: communicationRevision }) });
      setReplies(await apiRequest<Reply[]>(`${root}/replies`));
      setPreview(null);
      setMessage(path === 'needs-clarification' ? 'Clarification requested. Compose and send it when ready.' : path === 'mark-accepted' ? 'Renewal accepted. Review the proposed period before invoicing.' : path === 'mark-do-not-renew' ? 'Customer decision recorded: do not renew.' : 'Case kept in review.');
      await onChanged();
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
          purpose: preview.purpose, subject, body, idempotencyKey: requestKey, expectedRevision: preview.communicationRevision }),
      });
      setMessage(preview.purpose === 'CLARIFICATION'
        ? 'Clarification queued. The case moves to Waiting for Customer after SMTP accepts this message.'
        : 'Reminder queued. Waiting for Customer begins after SMTP acceptance.');
      setPreview(null);
      await onChanged();
    });
  }

  const reviewable = reminderStatuses.includes(status) || status === 'HUMAN_REVIEW';
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-medium">Customer communication</h4>
        <button className="button-secondary" disabled={busy} type="button" onClick={() => {
          void act(async () => {
            setReplies(await apiRequest<Reply[]>(`${root}/replies`));
            await onChanged();
          });
        }}>Refresh</button>
      </div>
      <Notice message={error} />
      <Notice message={message} tone="success" />
      {canManage && reviewable && (
        <div className="flex flex-wrap gap-2">
          {(reminderStatuses.includes(status) || clarificationPending) && (
            <button className="button-small" disabled={busy} onClick={compose} type="button">
              {clarificationPending ? 'Prepare Clarification' : 'Prepare Reminder'}
            </button>
          )}
        </div>
      )}
      {preview && (
        <form className="form-grid" onSubmit={send}>
          <div className="field-wide"><p>{preview.service} · Due {preview.dueDate.slice(0, 10)} · {preview.termMonths ?? 'Unconfigured'} months · {preview.amount} {preview.currency}</p>
            {preview.options.length > 0 && !preview.recipient && <p className="muted">No preferred renewal address. Select another registered contact explicitly, or add a preferred billing or primary contact.</p>}
            {preview.options.length === 0 && <p className="danger">No valid registered email. <Link className="table-link" href={`/dashboard/customers/${preview.customerId}`}>Open customer contacts</Link> and register an address before sending.</p>}
            <p className="muted">Only a registered customer address may be selected. No email is sent until you press Send Email.</p>
          </div>
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
            {preview.communicationRevision !== communicationRevision && <p className="danger">This draft is stale. Prepare a new message before sending.</p>}
             <button className="button-primary" disabled={busy || recipientIndex < 0 || !body.trim() || preview.communicationRevision !== communicationRevision} type="submit">Send Email</button>
            <button className="button-secondary" onClick={() => setPreview(null)} type="button">Cancel</button>
          </div>
        </form>
      )}
      {replies.filter((reply) => reply.direction === 'INBOUND').map((reply) => (
        <article className="rounded border border-[var(--line)] p-3" key={reply.id}>
          <p className="font-medium">{reply.subject}</p>
          <p className="muted text-sm">{reply.fromAddress} · {new Date(reply.occurredAt).toLocaleString()} · {reply.reviewedAt ? 'Read' : 'Unread'}</p>
          <p className="mt-2 whitespace-pre-wrap text-sm">{reply.bodyText}</p>
          {canManage && reviewable && <div className="mt-2 flex gap-2 flex-wrap">
            <button className="button-small" disabled={busy} onClick={() => review('mark-accepted', reply.id)} type="button">Accept Renewal</button>
            <button className="button-small" disabled={busy} onClick={() => review('mark-do-not-renew', reply.id)} type="button">Do Not Renew</button>
            {!clarificationPending && <button className="button-small" disabled={busy} onClick={() => review('needs-clarification', reply.id)} type="button">Needs Clarification</button>}
            <button className="button-small" disabled={busy} onClick={() => review('keep-in-review', reply.id)} type="button">Keep in Review</button>
          </div>}
          {canManage && (
            <button className="button-small mt-2" disabled={busy} onClick={() => {
              void act(async () => {
                await apiRequest(`${root}/replies/${reply.id}/${reply.reviewedAt ? 'unread' : 'read'}`, { method: 'POST' });
                setReplies(await apiRequest<Reply[]>(`${root}/replies`));
                await onChanged();
              });
            }} type="button">{reply.reviewedAt ? 'Mark unread' : 'Mark read'}</button>
          )}
        </article>
      ))}
    </section>
  );
}
