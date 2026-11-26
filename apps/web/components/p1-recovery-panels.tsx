'use client';

import { useState, type FormEvent } from 'react';
import { apiRequest } from '../lib/api';
import { useControlPanel } from './app-shell';
import { Modal } from './modal';
import { Notice } from './notice';

type QrCorrection = {
  id: string; invoiceRevision: number; oldImageDataUrl: string | null; newImageDataUrl: string;
  reason: string; actorId: string; createdAt: string;
};

function readImage(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Unable to read image.'));
    reader.onerror = () => reject(new Error('Unable to read image.'));
    reader.readAsDataURL(file);
  });
}

export function InvoiceQrRecovery({ invoiceId, revision, onChanged }: {
  invoiceId: string; revision: number; onChanged: () => void | Promise<void>;
}) {
  const { can } = useControlPanel();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [history, setHistory] = useState<QrCorrection[]>([]);
  const path = `/invoices/${invoiceId}/qr-corrections`;
  if (!can('ADMIN')) return null;

  async function loadHistory() {
    setOpen(true);
    try {
      setHistory(await apiRequest<QrCorrection[]>(path));
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load QR history.');
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const image = form.get('image');
    if (!(image instanceof File) || !image.size || image.size > 45000) {
      setError('Select a PNG, JPEG or WebP image of up to 45,000 bytes.');
      return;
    }
    try {
      setBusy(true);
      setError('');
      setMessage('');
      await apiRequest(path, {
        method: 'POST',
        body: JSON.stringify({ expectedRevision: revision, qrImageDataUrl: await readImage(image), reason: form.get('reason') }),
      });
      formElement.reset();
      setMessage('QR correction saved. The original remains in history.');
      await Promise.all([onChanged(), loadHistory()]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to correct the historical QR.');
    } finally {
      setBusy(false);
    }
  }

  return <>
    <button type="button" className="button-secondary no-print" onClick={() => void loadHistory()}>QR correction and history</button>
    {open && <Modal title="Official invoice QR history" closeDisabled={busy} onClose={() => { if (!busy) setOpen(false); }}>
      <Notice message={error} />
      <Notice message={message} tone="success" />
      <form className="form-grid" onSubmit={(event) => void submit(event)}>
        <label className="field">Replacement QR image<input name="image" type="file" accept="image/png,image/jpeg,image/webp" required /></label>
        <label className="field">Correction reason<textarea name="reason" maxLength={500} required /></label>
        <button type="submit" className="button-primary" disabled={busy}>Save correction</button>
      </form>
      <ul className="space-y-2">
        {history.map((record) => (
          <li key={record.id}>
            <p>Revision {record.invoiceRevision} · {record.actorId} · {record.createdAt}</p>
            <p>{record.reason}</p>
            {[['Previous image', record.oldImageDataUrl], ['Replacement image', record.newImageDataUrl]].map(([label, data]) =>
              data && /^data:image\/(png|jpeg|webp);base64,/.test(data)
                // eslint-disable-next-line @next/next/no-img-element
                ? <img key={label} src={data} alt={label ?? ''} width={88} height={88} />
                : <span key={label}>{label} unavailable for preview. </span>,
            )}
          </li>
        ))}
      </ul>
    </Modal>}
  </>;
}

export function LegacyRenewalRecovery({ caseId, status, dueDate, periodStart, periodEnd, nextRenewalDate, onChanged }: {
  caseId: string; status: string; dueDate: string;
  periodStart?: string | null; periodEnd?: string | null; nextRenewalDate?: string | null;
  onChanged: () => void | Promise<void>;
}) {
  const { can } = useControlPanel();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  if (!can('ADMIN') || status !== 'ACCEPTED' || (!open && periodStart && periodEnd && nextRenewalDate)) return null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = Object.fromEntries(new FormData(event.currentTarget));
    try {
      setBusy(true);
      setError('');
      await apiRequest(`/renewal-cases/${caseId}/repair-proposed-dates`, { method: 'POST', body: JSON.stringify(input) });
      setMessage('Proposed dates saved. Subscription tracking was not changed.');
      await onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to repair proposed dates.');
    } finally {
      setBusy(false);
    }
  }

  return <>
    <button type="button" className="button-secondary" onClick={() => { setMessage(''); setOpen(true); }}>Repair missing proposed dates</button>
    {open && <Modal title="Repair proposed dates" closeDisabled={busy} onClose={() => { if (!busy) setOpen(false); }}>
      <Notice message={error} />
      <Notice message={message} tone="success" />
      <form className="form-grid" onSubmit={(event) => void submit(event)}>
        <label className="field">Period start<input name="periodStart" type="date" required readOnly defaultValue={(periodStart ?? dueDate).slice(0, 10)} /></label>
        <label className="field">Period end<input name="periodEnd" type="date" required readOnly={!!periodEnd} defaultValue={periodEnd?.slice(0, 10)} /></label>
        <label className="field">Next renewal date<input name="nextRenewalDate" type="date" required readOnly={!!nextRenewalDate} defaultValue={nextRenewalDate?.slice(0, 10)} /></label>
        <label className="field">Correction reason<textarea name="reason" maxLength={500} required /></label>
        <button type="submit" className="button-primary" disabled={busy || !!message}>Save</button>
      </form>
    </Modal>}
  </>;
}
