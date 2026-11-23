'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { apiRequest } from '../lib/api';
import { useControlPanel } from './app-shell';
import { Modal } from './modal';
import { Notice } from './notice';
import { PaymentReceiptDocument, type PaymentReceiptView, type ReceiptRevisionView } from './payment-receipt-document';

type ReceiptRevision = ReceiptRevisionView;
type Payment = {
  id: string; amount: string; paymentDate: string; method: string;
  receipt: { id: string; revisions: ReceiptRevision[] } | null;
};
type Collection = {
  invoiceNumber: string; currency: string; total: string; paid: string; balance: string;
  unresolved: number; status: string; payments: Payment[];
};
type ReceiptHistory = PaymentReceiptView;
type Balance = { currency: string; invoiced: string; collected: string; outstanding: string; unresolved: number };

const methods = [
  ['BANK_TRANSFER', 'Bank transfer'], ['CASH', 'Cash'], ['CHEQUE', 'Cheque'],
  ['CARD_GATEWAY', 'Card gateway'], ['OTHER', 'Other'],
];

export function InvoicePaymentsPanel({ invoiceId }: { invoiceId: string }) {
  const { can } = useControlPanel();
  return can('ADMIN') ? <CollectionPanel invoiceId={invoiceId} /> : null;
}

function CollectionPanel({ invoiceId }: { invoiceId: string }) {
  const path = `/invoices/${invoiceId}/payments`;
  const [summary, setSummary] = useState<Collection | null>(null);
  const [editing, setEditing] = useState<{ payment: Payment; voiding: boolean } | null>(null);
  const [document, setDocument] = useState<ReceiptHistory | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const pending = useRef<{ payload: string; key: string } | null>(null);

  const reload = useCallback(() => apiRequest<Collection>(path).then(setSummary), [path]);
  useEffect(() => {
    void reload().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Unable to load balances.'));
  }, [reload]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !summary) return;
    const form = new FormData(event.currentTarget);
    const read = (field: string) => String(form.get(field) ?? '').trim();
    const values = editing?.voiding ? {} : {
      amount: read('amount'), paymentDate: read('paymentDate'), method: read('method'),
      reference: read('reference'), notes: read('notes'),
    };
    const payload = editing
      ? { ...values, expectedVersion: editing.payment.receipt!.revisions[0]!.version, reason: read('reason') }
      : { ...values, currency: summary.currency };
    const url = editing
      ? `${path}/${editing.payment.id}/receipt${editing.voiding ? '/void' : ''}`
      : path;
    const identity = JSON.stringify([url, payload]);
    if (pending.current?.payload !== identity) pending.current = { payload: identity, key: crypto.randomUUID() };
    try {
      setBusy(true);
      setError('');
      await apiRequest(url, {
        method: editing && !editing.voiding ? 'PATCH' : 'POST',
        body: JSON.stringify({ ...payload, idempotencyKey: pending.current.key }),
      });
      pending.current = null;
      setEditing(null);
      setAdding(false);
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save receipt.');
    } finally {
      setBusy(false);
    }
  }

  async function receipt(payment: Payment) {
    const url = `${path}/${payment.id}/receipt`;
    try {
      setBusy(true);
      setError('');
      if (!payment.receipt) await apiRequest(url, { method: 'POST' });
      setDocument(await apiRequest<ReceiptHistory>(url));
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load receipt.');
    } finally {
      setBusy(false);
    }
  }

  const version = editing?.payment.receipt?.revisions[0];
  return (
    <section className="panel">
      <h2>Payments and receipts</h2>
      <Notice message={error} />
      {summary && <>
        <p>Official invoice {summary.invoiceNumber} · {summary.currency}</p>
        <p>Invoiced {summary.total} · Collected {summary.paid} · Outstanding {summary.balance}</p>
        {summary.status === 'OVERPAID' && <p>Review excess funds before taking any further action.</p>}
        {summary.unresolved > 0 && <p>{summary.unresolved} payment records require receipt or legacy review.</p>}
        <button type="button" className="button-primary" disabled={busy} onClick={() => setAdding(true)}>Record payment</button>
        <ul className="space-y-2">
          {summary.payments.map((payment) => {
            const current = payment.receipt?.revisions[0];
            return (
              <li key={payment.id}>
                <span>{current?.amount ?? payment.amount} {summary.currency} · {current?.voided ? 'Void history' : current ? 'Active receipt' : 'Pending review'}</span>{' '}
                <button type="button" className="button-secondary" disabled={busy} onClick={() => void receipt(payment)}>
                  {payment.receipt ? 'Receipt history' : 'Issue receipt'}
                </button>{' '}
                {current && !current.voided && <>
                  <button type="button" className="button-secondary" disabled={busy} onClick={() => setEditing({ payment, voiding: false })}>Correct receipt</button>{' '}
                  <button type="button" className="button-secondary" disabled={busy} onClick={() => setEditing({ payment, voiding: true })}>Void receipt</button>
                </>}
              </li>
            );
          })}
        </ul>
        {(adding || editing) && <Modal title={editing ? editing.voiding ? 'Void receipt' : 'Correct receipt' : 'Record payment'}
          onClose={() => { if (!busy) { setEditing(null); setAdding(false); } }}>
          <Notice message={error} />
          <form className="form-grid" onSubmit={(event) => void submit(event)}>
            {!editing?.voiding && <>
              <label className="field">Amount<input name="amount" inputMode="decimal" required defaultValue={version?.amount} /></label>
              <label className="field">Payment date<input name="paymentDate" type="date" required defaultValue={version?.paymentDate.slice(0, 10)} /></label>
              <label className="field">Method<select name="method" defaultValue={version?.method}>{methods.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label className="field">Reference<input name="reference" maxLength={191} defaultValue={version?.reference ?? ''} /></label>
              <label className="field">Notes<textarea name="notes" maxLength={5000} defaultValue={version?.notes ?? ''} /></label>
            </>}
            {editing && <label className="field">Reason<textarea name="reason" maxLength={500} required /></label>}
            <button className="button-primary" disabled={busy} type="submit">{editing?.voiding ? 'Confirm void' : 'Save'}</button>
          </form>
        </Modal>}
        {document && <Modal title={`Receipt for official invoice ${document.snapshot.invoiceNumber ?? summary.invoiceNumber}`} onClose={() => setDocument(null)} maxWidth="54rem">
          <PaymentReceiptDocument receipt={document} />
          <p>Receipt ID {document.id}</p>
          {document.revisions.length === 0 && <p>Legacy receipt requires review.</p>}
          <ul className="space-y-2">
            {document.revisions.map((revision) => (
              <li key={revision.version}>
                <strong>Version {revision.version}{revision.voided ? ' · Void' : ''}</strong>
                <p>{revision.amount} {revision.currency} · {revision.paymentDate.slice(0, 10)} · {revision.method}</p>
                <p>{revision.reference}</p>
                <p>{revision.reason} · {revision.createdAt} · {revision.actorId}</p>
              </li>
            ))}
          </ul>
        </Modal>}
      </>}
    </section>
  );
}

export function CustomerBalancesPanel({ customerId }: { customerId: string }) {
  const [balances, setBalances] = useState<Balance[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    apiRequest<Balance[]>(`/customers/${customerId}/payment-balances`)
      .then((result) => { if (active) setBalances(result); })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Unable to load balances.'); });
    return () => { active = false; };
  }, [customerId]);
  return <section className="panel">
    <h2>Outstanding balances</h2>
    <Notice message={error} />
    {balances?.length === 0 && <p>No verified official invoices.</p>}
    {balances?.map((balance) => <p key={balance.currency}>
      {balance.currency} · Invoiced {balance.invoiced} · Collected {balance.collected} · Outstanding {balance.outstanding}
      {balance.unresolved ? ` · ${balance.unresolved} require review` : ''}
    </p>)}
  </section>;
}
