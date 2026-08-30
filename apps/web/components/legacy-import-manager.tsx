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
  summary?: Record<string, number>;
}
interface DuplicateCandidate {
  customerId: string;
  customerCode: string;
  companyName: string;
  reasons: string[];
  score: number;
}
interface ServiceType {
  id: string;
  name: string;
  active: boolean;
}
interface BillingEntity {
  id: string;
  name: string;
  active: boolean;
}
interface CustomerOption {
  id: string;
  customerCode: string;
  companyName: string;
}
interface PackageOption {
  id: string;
  serviceTypeId: string;
  code: string;
  name: string;
  kind: string;
  specifications: Record<string, unknown> | null;
}
interface CustomerDraft {
  companyName?: string;
  contactName?: string;
  primaryEmail?: string;
  secondaryEmail?: string;
  phone?: string;
  address?: string;
  country?: string;
  taxNumber?: string;
  preferredLanguage?: string;
  billingEntityId?: string;
  notes?: string;
  contacts?: Array<Record<string, unknown>>;
}
interface SubscriptionDraft {
  serviceTypeId?: string;
  servicePackageId?: string;
  name?: string;
  description?: string;
  startDate?: string | null;
  renewalDate?: string | null;
  billingFrequency?: string;
  renewalIntervalMonths?: number | null;
  contractTermMonths?: number | null;
  supplierCost?: string;
  sellingPrice?: string;
  currency?: string;
  providerAutoRenews?: boolean;
  graceHours?: number;
  status?: string;
  sourceRegistration?: string;
  packageNameSnapshot?: string;
  packageSpecificationsSnapshot?: Record<string, unknown>;
  customPackage?: boolean;
  classificationStatus?: string;
  classificationEvidence?: Record<string, unknown>;
  priceOverrideReason?: string;
  identifiers?: Array<{ type: string; value: string; label?: string }>;
  notes?: string;
}
interface ImportRow {
  id: string;
  sheetName: string;
  sourceRowNumber: number;
  sourceReference: string;
  rawPreview: Record<string, unknown>;
  mappedCustomer: CustomerDraft | null;
  mappedSubscriptions: SubscriptionDraft[] | null;
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

const emptySubscription = (): SubscriptionDraft => ({
  startDate: '',
  renewalDate: '',
  billingFrequency: 'ANNUAL',
  renewalIntervalMonths: 12,
  contractTermMonths: 12,
  sellingPrice: '',
  currency: 'JOD',
  providerAutoRenews: true,
  graceHours: 24,
  status: 'ACTIVE',
  sourceRegistration: '',
  packageNameSnapshot: '',
  customPackage: false,
  classificationStatus: 'MANUAL_REVIEW',
  classificationEvidence: {},
  identifiers: [],
});

export function LegacyImportManager() {
  const { can } = useControlPanel();
  const canReview = can('ADMIN', 'SALES_DEVELOPMENT');
  const [batches, setBatches] = useState<Batch[]>([]);
  const [selectedBatch, setSelectedBatch] = useState<Batch | null>(null);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [editing, setEditing] = useState<ImportRow | null>(null);
  const [customer, setCustomer] = useState<CustomerDraft>({});
  const [subscriptions, setSubscriptions] = useState<SubscriptionDraft[]>([]);
  const [resolution, setResolution] = useState('CREATE_NEW');
  const [candidateCustomerId, setCandidateCustomerId] = useState('');
  const [types, setTypes] = useState<ServiceType[]>([]);
  const [packages, setPackages] = useState<PackageOption[]>([]);
  const [entities, setEntities] = useState<BillingEntity[]>([]);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
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
    void Promise.all([
      loadBatches(),
      apiRequest<ServiceType[]>('/service-types').then(setTypes),
      apiRequest<PackageOption[]>('/service-packages?active=true').then(setPackages),
      apiRequest<BillingEntity[]>('/billing-entities').then(setEntities),
      apiRequest<PageResult<CustomerOption>>('/customers?pageSize=100').then((value) =>
        setCustomers(value.data),
      ),
    ]).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Load failed.'));
  }, [loadBatches]);

  function inspect(row: ImportRow) {
    setEditing(row);
    setCustomer(row.mappedCustomer ?? {});
    setSubscriptions(
      row.mappedSubscriptions?.length ? row.mappedSubscriptions : [emptySubscription()],
    );
    setResolution(row.customerResolution ?? 'CREATE_NEW');
    setCandidateCustomerId(row.candidateCustomerId ?? '');
  }

  async function upload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const result = await apiRequest<{ batch: Batch; reused: boolean; refreshedRows?: number }>(
        '/legacy-import/batches',
        {
          method: 'POST',
          body: new FormData(event.currentTarget),
        },
      );
      setMessage(
        result.reused
          ? `This exact workbook was already staged; ${result.refreshedRows ?? 0} untouched review rows were refreshed from its explicit dates.`
          : 'Workbook staged. Explicit dates were prefilled when valid; raw rows remain encrypted and require human approval.',
      );
      await loadBatches();
      await openBatch(result.batch, '');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Import failed.');
    }
  }

  async function deleteBatch(batch: Batch) {
    const confirmed = window.confirm(
      `Delete staged import ${batch.sourceFileName} and all unapproved staging rows? This cannot be undone.`,
    );
    if (!confirmed) return;
    setError('');
    try {
      const result = await apiRequest<{ deletedRows: number }>(
        `/legacy-import/batches/${batch.id}`,
        { method: 'DELETE' },
      );
      setSelectedBatch(null);
      setRows([]);
      setEditing(null);
      setMessage(
        `Import batch deleted. ${result.deletedRows} unapproved staging rows were removed; the workbook can now be staged again.`,
      );
      await loadBatches();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Import batch deletion failed.');
    }
  }


  async function review(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const form = new FormData(event.currentTarget);
    try {
      await apiRequest(`/legacy-import/rows/${editing.id}/review`, {
        method: 'PATCH',
        body: JSON.stringify({
          customerResolution: resolution,
          candidateCustomerId: resolution === 'ATTACH_EXISTING' ? candidateCustomerId : undefined,
          customer: resolution === 'ATTACH_EXISTING' ? undefined : customer,
          subscriptions,
          resolutionNotes: String(form.get('resolutionNotes') ?? '').trim() || undefined,
        }),
      });
      setMessage('Structured review validated and queued for Admin approval.');
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

  function patchSubscription(index: number, patch: Partial<SubscriptionDraft>) {
    setSubscriptions((current) =>
      current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)),
    );
  }
  function selectPackage(index: number, packageId: string) {
    const selected = packages.find((item) => item.id === packageId);
    patchSubscription(
      index,
      selected
        ? {
            servicePackageId: selected.id,
            serviceTypeId: selected.serviceTypeId,
            name: selected.name,
            packageNameSnapshot: selected.name,
            packageSpecificationsSnapshot: selected.specifications ?? {},
            customPackage: selected.kind === 'CUSTOM_TEMPLATE',
            classificationStatus:
              selected.kind === 'CUSTOM_TEMPLATE' ? 'CUSTOM' : 'MATCHED_OFFICIAL',
            classificationEvidence: {
              ...(subscriptions[index]?.classificationEvidence ?? {}),
              humanSelectedPackageCode: selected.code,
            },
          }
        : { servicePackageId: undefined, classificationStatus: 'MANUAL_REVIEW' },
    );
  }

  return (
    <>
      <PageHeading
        title="Legacy Excel import"
        description="Source rows are staged intact. Package, date, price, contact, duplicate, split, and merge decisions are explicit and audited."
      />
      <Notice message={error} />
      <Notice message={message} tone="success" />
      {can('ADMIN') && (
        <form
          className="panel mb-6 flex flex-wrap items-end gap-4"
          onSubmit={(event) => void upload(event)}
        >
          <label className="field min-w-[280px]">
            <span>Untouched legacy workbook (.xls/.xlsx, max 10 MB)</span>
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
                  {can('ADMIN') && (
                    <button
                      className='button-small danger'
                      onClick={() => void deleteBatch(selectedBatch)}
                      type='button'
                    >
                      Delete staged batch
                    </button>
                  )}
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
                      setStatus(event.target.value);
                      void openBatch(selectedBatch, event.target.value);
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
                        <th>Package status</th>
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
                          <td>{row.mappedCustomer?.companyName ?? 'Unmapped'}</td>
                          <td>
                            {row.mappedSubscriptions?.[0]?.classificationStatus ?? 'UNCLASSIFIED'}
                          </td>
                          <td>{row.duplicateCandidates.length}</td>
                          <td>{row.status}</td>
                          <td>
                            <button
                              className="button-small"
                              onClick={() => inspect(row)}
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
              </section>
            </>
          ) : (
            <section className="panel">
              <p className="muted text-sm">Select an import batch.</p>
            </section>
          )}
        </div>
      </section>
      {editing && (
        <div
          className="fixed inset-0 z-50 overflow-y-auto bg-black/60"
          onClick={(e) => { if (e.target === e.currentTarget) setEditing(null); }}
        >
          <div className="flex min-h-full items-start justify-center p-4 py-10">
          <section className="panel w-full max-w-5xl">
          <div className="flex justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold">Review {editing.sourceReference}</h3>
              <p className="muted mt-1 text-sm">
                Redacted preview is shown; encrypted raw values remain unchanged and traceable.
              </p>
            </div>
            <button className="button-secondary" onClick={() => setEditing(null)} type="button">
              Close
            </button>
          </div>
          <div className="mt-5 grid gap-6 xl:grid-cols-2">
            <div>
              <h4 className="font-medium">Raw source evidence</h4>
              <dl className="raw-grid mt-3">
                {Object.entries(editing.rawPreview).map(([key, value]) => (
                  <div key={key}>
                    <dt>{key}</dt>
                    <dd>{String(value ?? '')}</dd>
                  </div>
                ))}
              </dl>
              {!!editing.validationIssues.length && (
                <div className="notice notice-error mt-4">
                  <strong>Human decisions required</strong>
                  <ul className="mt-2 list-disc pl-5">
                    {editing.validationIssues.map((issue) => (
                      <li key={issue}>{issue}</li>
                    ))}
                  </ul>
                </div>
              )}
              {!!editing.duplicateCandidates.length && (
                <div className="notice mt-4">
                  <strong>Duplicate suggestions — no automatic merge</strong>
                  {editing.duplicateCandidates.map((item) => (
                    <p className="mt-2 text-sm" key={item.customerId}>
                      {item.customerCode} · {item.companyName}
                      <br />
                      {item.reasons.join(', ')}
                    </p>
                  ))}
                </div>
              )}
            </div>
            <div>
              {canReview && editing.status !== 'APPROVED' ? (
                <form className="space-y-5" onSubmit={(event) => void review(event)}>
                  <fieldset className="space-y-3 rounded-lg border border-[var(--line)] p-4">
                    <legend className="px-2 font-medium">Customer resolution</legend>
                    <label className="field">
                      <span>Decision</span>
                      <select
                        onChange={(event) => setResolution(event.target.value)}
                        value={resolution}
                      >
                        <option value="CREATE_NEW">Create new customer</option>
                        <option value="NOT_DUPLICATE">
                          Create new — reject duplicate suggestions
                        </option>
                        <option value="ATTACH_EXISTING">Attach existing customer</option>
                      </select>
                    </label>
                    {resolution === 'ATTACH_EXISTING' ? (
                      <label className="field">
                        <span>Existing customer</span>
                        <select
                          onChange={(event) => setCandidateCustomerId(event.target.value)}
                          required
                          value={candidateCustomerId}
                        >
                          <option value="">Select…</option>
                          {customers.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.customerCode} · {item.companyName}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : (
                      <>
                        <Text
                          label="Company name"
                          required
                          value={customer.companyName}
                          onChange={(value) => setCustomer({ ...customer, companyName: value })}
                        />
                        <Text
                          label="Contact name"
                          value={customer.contactName}
                          onChange={(value) => setCustomer({ ...customer, contactName: value })}
                        />
                        <Text
                          label="Primary email"
                          required
                          type="email"
                          value={customer.primaryEmail}
                          onChange={(value) => setCustomer({ ...customer, primaryEmail: value })}
                        />
                        <Text
                          label="Secondary email"
                          type="email"
                          value={customer.secondaryEmail}
                          onChange={(value) => setCustomer({ ...customer, secondaryEmail: value })}
                        />
                        <Text
                          label="Phone"
                          value={customer.phone}
                          onChange={(value) => setCustomer({ ...customer, phone: value })}
                        />
                        <Text
                          label="Address"
                          value={customer.address}
                          onChange={(value) => setCustomer({ ...customer, address: value })}
                        />
                        <label className="field">
                          <span>Billing Entity</span>
                          <select
                            onChange={(event) =>
                              setCustomer({ ...customer, billingEntityId: event.target.value })
                            }
                            required
                            value={customer.billingEntityId ?? ''}
                          >
                            <option value="">Select…</option>
                            {entities
                              .filter((item) => item.active)
                              .map((item) => (
                                <option key={item.id} value={item.id}>
                                  {item.name}
                                </option>
                              ))}
                          </select>
                        </label>
                      </>
                    )}
                  </fieldset>
                  {subscriptions.map((subscription, index) => (
                    <fieldset
                      className="space-y-3 rounded-lg border border-[var(--line)] p-4"
                      key={index}
                    >
                      <legend className="px-2 font-medium">Subscription {index + 1}</legend>
                      <label className="field">
                        <span>Service Type</span>
                        <select
                          onChange={(event) =>
                            patchSubscription(index, {
                              serviceTypeId: event.target.value,
                              servicePackageId: undefined,
                              classificationStatus: 'MANUAL_REVIEW',
                            })
                          }
                          required
                          value={subscription.serviceTypeId ?? ''}
                        >
                          <option value="">Select…</option>
                          {types
                            .filter((item) => item.active)
                            .map((item) => (
                              <option key={item.id} value={item.id}>
                                {item.name}
                              </option>
                            ))}
                        </select>
                      </label>
                      <label className="field">
                        <span>Package decision</span>
                        <select
                          onChange={(event) => selectPackage(index, event.target.value)}
                          required
                          value={subscription.servicePackageId ?? ''}
                        >
                          <option value="">Human selection required…</option>
                          {packages
                            .filter(
                              (item) =>
                                !subscription.serviceTypeId ||
                                item.serviceTypeId === subscription.serviceTypeId,
                            )
                            .map((item) => (
                              <option key={item.id} value={item.id}>
                                {item.name} · {item.kind}
                              </option>
                            ))}
                        </select>
                      </label>
                      <Text
                        label="Sold package snapshot"
                        required
                        value={subscription.packageNameSnapshot}
                        onChange={(value) =>
                          patchSubscription(index, { packageNameSnapshot: value, name: value })
                        }
                      />
                      <Text
                        label="Source registration (preserved)"
                        required
                        value={subscription.sourceRegistration}
                        onChange={(value) =>
                          patchSubscription(index, { sourceRegistration: value })
                        }
                      />
                      <Text
                        label="Start date (confirmed)"
                        required
                        type="date"
                        value={subscription.startDate ?? ''}
                        onChange={(value) => patchSubscription(index, { startDate: value })}
                      />
                      <Text
                        label="Renewal date (confirmed)"
                        required
                        type="date"
                        value={subscription.renewalDate ?? ''}
                        onChange={(value) => patchSubscription(index, { renewalDate: value })}
                      />
                      <label className="field">
                        <span>Renewal interval</span>
                        <select
                          onChange={(event) =>
                            patchSubscription(index, {
                              renewalIntervalMonths: Number(event.target.value),
                              contractTermMonths: Number(event.target.value),
                              billingFrequency: frequency(Number(event.target.value)),
                            })
                          }
                          value={String(subscription.renewalIntervalMonths ?? 12)}
                        >
                          <option value="12">12 months</option>
                          <option value="24">24 months</option>
                          <option value="36">36 months</option>
                          <option value="60">60 months</option>
                          {subscription.renewalIntervalMonths &&
                            ![12, 24, 36, 60].includes(subscription.renewalIntervalMonths) && (
                              <option value={subscription.renewalIntervalMonths}>
                                Custom: {subscription.renewalIntervalMonths} months
                              </option>
                            )}
                        </select>
                      </label>
                      <Text
                        label="Custom interval months (1–120)"
                        type="number"
                        value={String(subscription.renewalIntervalMonths ?? '')}
                        onChange={(value) =>
                          patchSubscription(index, {
                            renewalIntervalMonths: Number(value),
                            billingFrequency: frequency(Number(value)),
                          })
                        }
                      />
                      <Text
                        label="Selling price (actual)"
                        required
                        type="number"
                        value={subscription.sellingPrice}
                        onChange={(value) => patchSubscription(index, { sellingPrice: value })}
                      />
                      <Text
                        label="Currency"
                        required
                        value={subscription.currency}
                        onChange={(value) =>
                          patchSubscription(index, { currency: value.toUpperCase() })
                        }
                      />
                      <Text
                        label="Negotiated price reason"
                        value={subscription.priceOverrideReason}
                        onChange={(value) =>
                          patchSubscription(index, { priceOverrideReason: value })
                        }
                      />
                      <label className="field">
                        <span>Domains / identifiers (one per line)</span>
                        <textarea
                          onChange={(event) =>
                            patchSubscription(index, {
                              identifiers: event.target.value
                                .split(/\r?\n/)
                                .map((value) => value.trim())
                                .filter(Boolean)
                                .map((value) => ({ type: 'DOMAIN', value })),
                            })
                          }
                          rows={3}
                          value={(subscription.identifiers ?? [])
                            .map((item) => item.value)
                            .join('\n')}
                        />
                      </label>
                      {subscriptions.length > 1 && (
                        <button
                          className="button-small danger"
                          onClick={() =>
                            setSubscriptions((current) =>
                              current.filter((_, itemIndex) => itemIndex !== index),
                            )
                          }
                          type="button"
                        >
                          Remove this explicitly split subscription
                        </button>
                      )}
                    </fieldset>
                  ))}
                  <button
                    className="button-secondary"
                    onClick={() => setSubscriptions((current) => [...current, emptySubscription()])}
                    type="button"
                  >
                    Add another subscription (explicit split)
                  </button>
                  <label className="field">
                    <span>Resolution notes / human rationale</span>
                    <textarea name="resolutionNotes" required rows={3} />
                  </label>
                  <button className="button-primary" type="submit">
                    Validate structured review
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
          </div>
        </div>
      )}
    </>
  );
}

function Text({
  label,
  value,
  onChange,
  required,
  type = 'text',
}: {
  label: string;
  value?: string;
  onChange: (value: string) => void;
  required?: boolean;
  type?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        onChange={(event) => onChange(event.target.value)}
        required={required}
        type={type}
        value={value ?? ''}
      />
    </label>
  );
}
function humanize(value: string) {
  return value.replace(/([A-Z])/g, ' $1').replace(/^./, (letter) => letter.toUpperCase());
}
function frequency(months: number) {
  return months === 1
    ? 'MONTHLY'
    : months === 3
      ? 'QUARTERLY'
      : months === 6
        ? 'SEMI_ANNUAL'
        : months === 12
          ? 'ANNUAL'
          : months === 24
            ? 'BIENNIAL'
            : 'CUSTOM';
}
