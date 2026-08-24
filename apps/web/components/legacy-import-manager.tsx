'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiRequest, type PageResult } from '../lib/api';
import { useControlPanel } from './app-shell';
import { Notice } from './notice';
import { PageHeading } from './page-heading';

interface Batch {
  id: string;
  sourceFileName: string;
  sourceFileHash: string;
  status: string;
  totalRows: number;
  createdAt: string;
  _count?: { rows: number };
  summary?: Record<string, number>;
}
interface DuplicateCandidate {
  customerId: string;
  customerCode: string;
  companyName: string;
  reasons: string[];
  score: number;
}
interface ImportRow {
  id: string;
  sheetName: string;
  sourceRowNumber: number;
  sourceReference: string;
  rawPreview: Record<string, unknown>;
  mappedCustomer: Record<string, unknown> | null;
  mappedSubscriptions: Array<Record<string, unknown>> | null;
  duplicateCandidates: DuplicateCandidate[];
  validationIssues: string[];
  status: string;
  validationStatus: string;
  customerResolution: string | null;
  candidateCustomerId: string | null;
  manualReviewReason: string | null;
  approvedCustomer?: { customerCode: string; companyName: string } | null;
  subscriptionLinks: Array<{ subscription: { subscriptionCode: string; name: string } }>;
}

export function LegacyImportManager() {
  const { can } = useControlPanel();
  const canReview = can('ADMIN', 'SALES_DEVELOPMENT');
  const [batches, setBatches] = useState<Batch[]>([]);
  const [selectedBatch, setSelectedBatch] = useState<Batch | null>(null);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [editing, setEditing] = useState<ImportRow | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState('REQUIRES_MANUAL_REVIEW');
  const loadBatches = useCallback(async () => {
    const result = await apiRequest<PageResult<Batch>>('/legacy-import/batches?pageSize=50');
    setBatches(result.data);
  }, []);
  const openBatch = useCallback(
    async (batch: Batch, rowStatus = status) => {
      const [detail, result] = await Promise.all([
        apiRequest<Batch>(`/legacy-import/batches/${batch.id}`),
        apiRequest<PageResult<ImportRow>>(
          `/legacy-import/batches/${batch.id}/rows?pageSize=100${rowStatus ? `&status=${rowStatus}` : ''}`,
        ),
      ]);
      setSelectedBatch(detail);
      setRows(result.data);
      setEditing(null);
    },
    [status],
  );
  useEffect(() => {
    void loadBatches().catch((cause: unknown) =>
      setError(cause instanceof Error ? cause.message : 'Load failed.'),
    );
  }, [loadBatches]);

  async function upload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError('');
    try {
      const result = await apiRequest<{ batch: Batch; reused: boolean }>('/legacy-import/batches', {
        method: 'POST',
        body: form,
      });
      setMessage(
        result.reused
          ? 'This exact workbook was already staged; the existing batch was reused.'
          : 'Workbook staged. Raw rows were encrypted and require human review.',
      );
      await loadBatches();
      await openBatch(result.batch, '');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Import failed.');
    }
  }

  async function review(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const form = new FormData(event.currentTarget);
    const resolution = String(form.get('customerResolution'));
    try {
      const customerText = String(form.get('mappedCustomer') ?? '').trim();
      const subscriptionsText = String(form.get('mappedSubscriptions') ?? '').trim();
      const body = {
        customerResolution: resolution,
        candidateCustomerId:
          resolution === 'ATTACH_EXISTING' ? String(form.get('candidateCustomerId')) : undefined,
        customer:
          resolution === 'ATTACH_EXISTING'
            ? undefined
            : (JSON.parse(customerText) as Record<string, unknown>),
        subscriptions: JSON.parse(subscriptionsText) as Array<Record<string, unknown>>,
        resolutionNotes: String(form.get('resolutionNotes') ?? '').trim() || undefined,
      };
      await apiRequest(`/legacy-import/rows/${editing.id}/review`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      setMessage('Staged row validated and queued for authorized approval.');
      setError('');
      if (selectedBatch) await openBatch(selectedBatch, status);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Review failed.');
    }
  }

  async function approve(row: ImportRow) {
    if (!window.confirm(`Approve ${row.sourceReference} into live records?`)) return;
    try {
      await apiRequest(`/legacy-import/rows/${row.id}/approve`, { method: 'POST' });
      setMessage('Staged row approved into traceable live records.');
      if (selectedBatch) await openBatch(selectedBatch, status);
      await loadBatches();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Approval failed.');
    }
  }

  return (
    <>
      <PageHeading
        title="Legacy Excel import"
        description="Raw workbook rows are staged, encrypted, validated, and explicitly approved. Suggestions never merge customers or fabricate missing service data."
      />
      <Notice message={error} />
      <Notice message={message} tone="success" />
      {can('ADMIN') && (
        <form
          className="panel mb-6 flex flex-wrap items-end gap-4"
          onSubmit={(event) => void upload(event)}
        >
          <label className="field min-w-[280px]">
            <span>Legacy Excel workbook (.xls or .xlsx, maximum 10 MB)</span>
            <input accept=".xls,.xlsx" name="file" required type="file" />
          </label>
          <button className="button-primary" type="submit">
            Stage workbook
          </button>
        </form>
      )}
      <section className="grid gap-6 xl:grid-cols-[360px_1fr]">
        <div className="panel">
          <h3 className="font-semibold">Import batches</h3>
          <div className="mt-4 space-y-3">
            {batches.map((batch) => (
              <button
                className={`batch-card ${selectedBatch?.id === batch.id ? 'batch-card-active' : ''}`}
                key={batch.id}
                onClick={() => void openBatch(batch)}
                type="button"
              >
                <strong>{batch.sourceFileName}</strong>
                <span>
                  {batch.status} · {batch.totalRows} rows
                </span>
                <span>{new Date(batch.createdAt).toLocaleString()}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="min-w-0">
          {selectedBatch ? (
            <>
              <section className="panel">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">{selectedBatch.sourceFileName}</h3>
                    <p className="muted mt-1 text-xs">SHA-256 {selectedBatch.sourceFileHash}</p>
                  </div>
                  <span className="status-pill">{selectedBatch.status}</span>
                </div>
                {selectedBatch.summary && (
                  <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
                    {Object.entries(selectedBatch.summary).map(([label, value]) => (
                      <div className="rounded-lg bg-[var(--surface)] p-3" key={label}>
                        <strong className="block text-xl">{value}</strong>
                        <span className="muted text-xs">{humanize(label)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
              <section className="panel mt-6">
                <div className="toolbar">
                  <h3 className="font-semibold">Staged rows</h3>
                  <select
                    aria-label="Row status"
                    onChange={(event) => {
                      const next = event.target.value;
                      setStatus(next);
                      void openBatch(selectedBatch, next);
                    }}
                    value={status}
                  >
                    <option value="">All statuses</option>
                    <option>REQUIRES_MANUAL_REVIEW</option>
                    <option>READY_FOR_APPROVAL</option>
                    <option>APPROVED</option>
                    <option>FAILED</option>
                    <option>SKIPPED</option>
                  </select>
                </div>
                <div className="table-wrap mt-4">
                  <table>
                    <thead>
                      <tr>
                        <th>Source</th>
                        <th>Candidate</th>
                        <th>Duplicates</th>
                        <th>Status</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row.id}>
                          <td>
                            {row.sheetName}!{row.sourceRowNumber}
                          </td>
                          <td>{String(row.mappedCustomer?.companyName ?? 'Unmapped')}</td>
                          <td>{row.duplicateCandidates.length}</td>
                          <td>{row.status}</td>
                          <td>
                            <button
                              className="button-small"
                              onClick={() => setEditing(row)}
                              type="button"
                            >
                              Inspect
                            </button>
                            {can('ADMIN') && row.status === 'READY_FOR_APPROVAL' && (
                              <button
                                className="button-small ml-2"
                                onClick={() => void approve(row)}
                                type="button"
                              >
                                Approve
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!rows.length && <p className="muted mt-4 text-sm">No rows match this filter.</p>}
              </section>
            </>
          ) : (
            <section className="panel">
              <p className="muted text-sm">
                Select an import batch to review its traceable rows and report.
              </p>
            </section>
          )}
        </div>
      </section>
      {editing && (
        <section className="panel mt-6">
          <div className="flex justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold">Review {editing.sourceReference}</h3>
              <p className="muted mt-1 text-sm">
                Raw values are a redacted preview; the preserved original is encrypted at rest.
              </p>
            </div>
            <button className="button-secondary" onClick={() => setEditing(null)} type="button">
              Close
            </button>
          </div>
          <div className="mt-5 grid gap-6 xl:grid-cols-2">
            <div>
              <h4 className="font-medium">Raw source preview</h4>
              <dl className="raw-grid mt-3">
                {Object.entries(editing.rawPreview).map(([key, value]) => (
                  <div key={key}>
                    <dt>{key}</dt>
                    <dd>{String(value ?? '')}</dd>
                  </div>
                ))}
              </dl>
              {editing.validationIssues.length > 0 && (
                <div className="notice notice-error mt-4">
                  <strong>Validation issues</strong>
                  <ul className="mt-2 list-disc pl-5">
                    {editing.validationIssues.map((issue) => (
                      <li key={issue}>{issue}</li>
                    ))}
                  </ul>
                </div>
              )}
              {editing.duplicateCandidates.length > 0 && (
                <div className="notice mt-4">
                  <strong>Duplicate suggestions — human decision required</strong>
                  {editing.duplicateCandidates.map((candidate) => (
                    <p className="mt-2 text-sm" key={candidate.customerId}>
                      {candidate.customerCode} · {candidate.companyName}
                      <br />
                      {candidate.reasons.join(', ')}
                    </p>
                  ))}
                </div>
              )}
            </div>
            <div>
              {canReview && editing.status !== 'APPROVED' ? (
                <form className="space-y-4" onSubmit={(event) => void review(event)}>
                  <label className="field">
                    <span>Customer resolution</span>
                    <select
                      defaultValue={editing.customerResolution ?? 'CREATE_NEW'}
                      name="customerResolution"
                    >
                      <option value="CREATE_NEW">Create new customer</option>
                      <option value="NOT_DUPLICATE">Create new — suggestions rejected</option>
                      <option value="ATTACH_EXISTING">Attach existing customer</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Existing duplicate candidate (required only when attaching)</span>
                    <select
                      defaultValue={editing.candidateCustomerId ?? ''}
                      name="candidateCustomerId"
                    >
                      <option value="">Select…</option>
                      {editing.duplicateCandidates.map((candidate) => (
                        <option key={candidate.customerId} value={candidate.customerId}>
                          {candidate.customerCode} · {candidate.companyName}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Mapped customer JSON</span>
                    <textarea
                      defaultValue={JSON.stringify(editing.mappedCustomer ?? {}, null, 2)}
                      name="mappedCustomer"
                      rows={12}
                    />
                  </label>
                  <label className="field">
                    <span>Mapped subscriptions JSON (one or more)</span>
                    <textarea
                      defaultValue={JSON.stringify(editing.mappedSubscriptions ?? [], null, 2)}
                      name="mappedSubscriptions"
                      rows={14}
                    />
                  </label>
                  <label className="field">
                    <span>Resolution notes</span>
                    <textarea name="resolutionNotes" rows={3} />
                  </label>
                  <button className="button-primary" type="submit">
                    Validate review
                  </button>
                </form>
              ) : (
                <div className="notice">
                  <strong>{editing.status}</strong>
                  <p className="mt-2 text-sm">
                    {editing.approvedCustomer
                      ? `${editing.approvedCustomer.customerCode} · ${editing.approvedCustomer.companyName}`
                      : 'Read-only for your role or row status.'}
                  </p>
                  {editing.subscriptionLinks.map((link) => (
                    <p className="mt-1 text-sm" key={link.subscription.subscriptionCode}>
                      {link.subscription.subscriptionCode} · {link.subscription.name}
                    </p>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>
      )}
    </>
  );
}

function humanize(value: string) {
  return value.replace(/([A-Z])/g, ' $1').replace(/^./, (letter) => letter.toUpperCase());
}
