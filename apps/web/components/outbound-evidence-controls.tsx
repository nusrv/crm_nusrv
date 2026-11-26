'use client';

import { useState } from 'react';
import Link from 'next/link';
import { mailDispatchStatus } from '../lib/workspace-status';
import { apiRequest } from '../lib/api';

interface Evidence {
  attempts: number;
  smtpUncertain: boolean;
  status: string;
  resendOfId: string | null;
  lastError: string | null;
  smtpEvidence?: { state: 'SMTP_ACCEPTED' | 'MOCK_ONLY' | 'UNVERIFIED' | 'REVIEW_REQUIRED'; responseCode: number | null };
  mailboxEvidence?: { sent: Array<{ folder: string; observedAt: string; internalDate: string | null }>; followUps: Array<{ id: string; status: string; recipient: string; createdAt: string; enhancedStatuses: string[] }>; limited: boolean; recipientDelivery: 'UNVERIFIED' };
  events: { id: string; eventKey: string; actorId: string | null; metadata: unknown; createdAt: string }[];
}

export function OutboundEvidenceControls({ path, onChanged }: { path: string; onChanged: () => void }) {
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [requestKey, setRequestKey] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function inspect() {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      setEvidence(await apiRequest<Evidence>(`${path}/evidence`));
      setRequestKey(current => current ?? crypto.randomUUID());
      setAcknowledged(false);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Unable to load delivery evidence.');
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    if (!requestKey || !acknowledged || busy) return;
    setBusy(true);
    try {
      await apiRequest(`${path}/resend`, {
        method: 'POST',
        body: JSON.stringify({ idempotencyKey: requestKey, acknowledgeDuplicateRisk: true }),
      });
      setRequestKey(null);
      setMessage('Authorized resend queued.');
      onChanged();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Unable to queue a resend.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <button className="button-small" disabled={busy} onClick={() => void inspect()} type="button">
        Inspect delivery evidence
      </button>
      {evidence && (
        <div className="space-y-2 text-sm">
          <p>{mailDispatchStatus(evidence.status, evidence.smtpUncertain)}</p>
          <p>{evidence.smtpEvidence?.state === 'SMTP_ACCEPTED'
            ? 'Sending SMTP server accepted this attempt (code ' + evidence.smtpEvidence.responseCode + '). Recipient delivery is not verified.'
            : evidence.smtpEvidence?.state === 'MOCK_ONLY' ? 'Simulated dispatch only; no real SMTP acceptance.'
            : evidence.smtpEvidence?.state === 'REVIEW_REQUIRED' ? 'SMTP evidence requires review; recipient delivery is not verified.'
            : 'No verified SMTP acceptance in the recorded audit history.'}</p>
          {evidence.mailboxEvidence && <div className="space-y-1">
            <p>Matching Sent-folder headers: {evidence.mailboxEvidence.sent.length}. These are observations only, not delivery evidence.</p>
            {evidence.mailboxEvidence.sent.slice(0, 5).map((item, i) => <p key={`${item.folder}:${item.observedAt}:${i}`}>{item.folder} · observed {new Date(item.observedAt).toLocaleString()}</p>)}
            {evidence.mailboxEvidence.followUps.map(item => <p key={item.id}>Recorded hard-failure follow-up · {item.enhancedStatuses.join(', ')} · {item.recipient} · {item.status === 'RESOLVED' ? 'Reviewed / resolved' : 'Needs review'}. <Link href="/dashboard/action-queue">Action Queue</Link></p>)}
            {evidence.mailboxEvidence.limited && <p>Evidence history is bounded; additional observations may exist.</p>}
            <p>Recipient delivery: not independently verified.</p>
          </div>}
          <p>{evidence.attempts} attempted dispatches{evidence.lastError ? ` · ${evidence.lastError}` : ''}</p>
          {evidence.resendOfId && <p>Original outbox entry {evidence.resendOfId}</p>}
          <details><summary>Advanced: recorded dispatch audit</summary><ul className="space-y-2">
            {evidence.events.map((event) => (
              <li className="break-all" key={event.id}>
                <p>{new Date(event.createdAt).toLocaleString()} · {event.eventKey}</p>
                {event.metadata != null && <pre className="whitespace-pre-wrap">{JSON.stringify(event.metadata, null, 2)}</pre>}
              </li>
            ))}
          </ul></details>
          {evidence.smtpUncertain && evidence.status === 'FAILED' && evidence.smtpEvidence?.state !== 'SMTP_ACCEPTED' && evidence.smtpEvidence?.state !== 'REVIEW_REQUIRED' && requestKey && (
            <>
              <label className="flex items-start gap-2">
                <input checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} type="checkbox" />
                The previous message may already have reached the customer. I authorize a resend that may result in duplicate delivery.
              </label>
              <button className="button-small" disabled={!acknowledged || busy} onClick={() => void resend()} type="button">
                Authorize resend
              </button>
            </>
          )}
        </div>
      )}
      {message && <p className="text-sm" role="status">{message}</p>}
    </div>
  );
}
