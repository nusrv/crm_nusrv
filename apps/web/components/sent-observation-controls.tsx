'use client';

import { useState, useRef } from 'react';
import { apiRequest } from '../lib/api';

interface SentState { enabled: boolean; state: string; folderName?: string; lastProbeAt?: string | null; lastObservedAt?: string | null; lastError?: string | null }

export function SentObservationControls({ mailboxId }: { mailboxId: string }) {
  const [state, setState] = useState<SentState | null>(null);
  const [message, setMessage] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const path = '/settings/mail/' + encodeURIComponent(mailboxId) + '/sent-observation';
  async function act(action?: 'activate' | 'stop') {
    if (lock.current || (action === 'activate' && !confirmed)) return;
    lock.current = true;
    setBusy(true); setMessage('');
    try {
      if (action) await apiRequest(path + '/' + action, {
        method: 'POST', ...(action === 'activate' ? { body: JSON.stringify({ futureOnly: true }) } : {}),
      });
      setState(await apiRequest<SentState>(path));
      setConfirmed(false);
      if (action) setMessage(action === 'activate' ? 'Future-only observation activated.' : 'Observation stopped; history preserved.');
    } catch (error) {
      setState(null); setConfirmed(false);
      setMessage(error instanceof Error ? error.message : 'Unable to verify Sent observation state.');
    } finally { lock.current = false; setBusy(false); }
  }
  const labels: Record<string, string> = {
    BLOCKED_BY_DEPLOYMENT: 'Not released for this deployment',
    PAUSED_FOR_MAINTENANCE: 'Paused for deployment maintenance',
    DISABLED_OR_NOT_CONFIGURED: 'Requires enabled, secure, real IMAP',
    BASELINE_REQUIRED: 'Awaiting explicit activation',
    OBSERVING: 'Observation configured (not delivery proof)',
  };
  return <div className="space-y-2 text-sm">
    <button type="button" className="button-small" disabled={busy} onClick={() => void act()}>Inspect Sent observation</button>
    {state && <div className="space-y-2">
      <p>{labels[state.state] ?? 'Unknown observation state'}{state.folderName ? ' · ' + state.folderName : ''}</p>
      {state.lastProbeAt && <p>Last poll: {new Date(state.lastProbeAt).toLocaleString()}</p>}
      {state.lastObservedAt && <p>Last new observation: {new Date(state.lastObservedAt).toLocaleString()}</p>}
      {state.lastError && <p role="status">Review required: {state.lastError.replaceAll('_', ' ').toLowerCase()}</p>}
      {state.state === 'BASELINE_REQUIRED' && state.enabled && <>
        <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} />Start with future messages only; do not import historical Sent mail.</label>
        <button type="button" className="button-small" disabled={busy || !confirmed} onClick={() => void act('activate')}>Activate Sent observation</button>
      </>}
      {(state.state === 'OBSERVING' || state.state === 'PAUSED_FOR_MAINTENANCE') && <button type="button" className="button-small" disabled={busy} onClick={() => void act('stop')}>Stop observation (retain history)</button>}
      <p className="muted">A Sent copy is not proof of delivery, acceptance or bounce.</p>
    </div>}
    {message && <p role="status">{message}</p>}
  </div>;
}
