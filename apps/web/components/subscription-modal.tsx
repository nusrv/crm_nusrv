'use client';

import { useCallback, useEffect, useState } from 'react';
import { addCalendarMonths } from '@cp/shared';
import { apiRequest, type PageResult } from '../lib/api';
import { customerCombinedLabel } from '../lib/customer-name';
import { useControlPanel } from './app-shell';
import { CustomerCombobox, type CustomerComboboxOption } from './customer-combobox';
import type { CurrencyOption } from './currencies-manager';
import { Modal } from './modal';
import { Notice } from './notice';

const PRESET_INTERVALS = ['12', '24', '36', '60'] as const;
type IntervalPreset = (typeof PRESET_INTERVALS)[number] | 'CUSTOM';

interface ServiceTypeOption {
  id: string;
  code: string;
  name: string;
  active: boolean;
}
interface PackageOption {
  id: string;
  serviceTypeId: string;
  code: string;
  name: string;
  kind: string;
  active: boolean;
  terms: Array<{ termMonths: number; currency: string; standardSellingPrice: string }>;
}
interface SubscriptionIdentifier {
  id: string;
  type: string;
  value: string;
  label: string | null;
}
interface ConnectionOption {
  id: string;
  code: string;
  name: string;
  type: string;
  enabled: boolean;
}
interface Mapping {
  id: string;
  technicalConnectionId: string;
  remoteIdentifier: string;
  actionProfile: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  active: boolean;
  technicalConnection: ConnectionOption;
}
interface Subscription {
  id: string;
  customerId: string;
  serviceTypeId: string;
  servicePackageId: string | null;
  subscriptionCode: string;
  name: string;
  description: string | null;
  startDate: string;
  renewalDate: string;
  billingFrequency: string;
  renewalIntervalMonths: number | null;
  contractTermMonths: number | null;
  supplierCost: string | null;
  sellingPrice: string;
  currency: string;
  exchangeRateToJod: string | null;
  sellingPriceJod: string | null;
  currentExchangeRateToJod: string | null;
  currentExchangeRateEffectiveDate: string | null;
  currentSellingPriceJod: string | null;
  providerAutoRenews: boolean;
  graceHours: number;
  status: string;
  notes: string | null;
  customer: CustomerComboboxOption;
  serviceType: ServiceTypeOption;
  servicePackage: PackageOption | null;
  packageNameSnapshot: string | null;
  classificationStatus: string;
  priceOverrideReason: string | null;
  identifiers: SubscriptionIdentifier[];
  connections: Mapping[];
}

const toDateInput = (value?: string) => (value ? value.slice(0, 10) : '');

/** `null` covers 60 months, "custom" values, and — importantly — 60 not appearing verbatim. */
function presetForMonths(months: number | null): IntervalPreset {
  if (months && (PRESET_INTERVALS as readonly string[]).includes(String(months))) {
    return String(months) as IntervalPreset;
  }
  return 'CUSTOM';
}

/**
 * Shared "create / view / manage" subscription popup. Used both by the Subscriptions list page
 * and by any other page (e.g. customer detail) that wants to show a single subscription without
 * navigating away.
 *
 * Two create modes: pass `lockedCustomer` when the Customer is already known (e.g. opened from
 * Customer Details) — it is shown read-only and never re-selectable, since Subscription Code
 * generation depends on it. Omit it to show the searchable Customer Combobox instead (never a
 * plain `<select>` of every customer).
 */
export function SubscriptionModal({
  subscriptionId,
  lockedCustomer,
  onClose,
  onSaved,
  onDeleted,
}: {
  subscriptionId: string | null;
  lockedCustomer?: CustomerComboboxOption;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const { can } = useControlPanel();
  const canManage = can('ADMIN', 'ACCOUNTANT');
  const canMap = can('ADMIN', 'IT');
  const [editing, setEditing] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(Boolean(subscriptionId));
  const [types, setTypes] = useState<ServiceTypeOption[]>([]);
  const [packages, setPackages] = useState<PackageOption[]>([]);
  const [connections, setConnections] = useState<ConnectionOption[]>([]);
  const [currencies, setCurrencies] = useState<CurrencyOption[]>([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  // Mode B (general Subscriptions page, no lockedCustomer): searchable Customer Combobox state.
  const [customerOptions, setCustomerOptions] = useState<CustomerComboboxOption[]>([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerSearchLoading, setCustomerSearchLoading] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [selectedCustomerLabel, setSelectedCustomerLabel] = useState('');

  // Start Date / Renewal Interval / live "Next Renewal Date" preview. Used for create (always) and
  // for editing a subscription that already has a Renewal Interval. A historical subscription with
  // no Renewal Interval (`renewalIntervalMonths: null`) instead falls back to the plain two-date
  // legacy fields further below — see `hasIntervalModel`.
  const [startDateValue, setStartDateValue] = useState('');
  const [intervalPreset, setIntervalPreset] = useState<IntervalPreset>('12');
  const [customMonthsValue, setCustomMonthsValue] = useState('12');
  const [originalStartDate, setOriginalStartDate] = useState('');
  const [originalIntervalMonths, setOriginalIntervalMonths] = useState<number | null>(null);

  const hasIntervalModel = !editing || editing.renewalIntervalMonths != null;
  const effectiveIntervalMonths =
    intervalPreset === 'CUSTOM' ? Number(customMonthsValue) : Number(intervalPreset);
  const previewRenewalDate =
    startDateValue && effectiveIntervalMonths > 0
      ? addCalendarMonths(new Date(startDateValue), effectiveIntervalMonths)
      : null;

  const refreshEditing = useCallback(async (id: string) => {
    setEditing(await apiRequest<Subscription>(`/subscriptions/${id}`));
  }, []);

  useEffect(() => {
    void Promise.all([
      apiRequest<ServiceTypeOption[]>('/service-types'),
      apiRequest<PackageOption[]>('/service-packages?active=true'),
      canMap ? apiRequest<ConnectionOption[]>('/technical-connections') : Promise.resolve([]),
      apiRequest<CurrencyOption[]>('/currencies?active=true'),
    ])
      .then(([serviceTypes, packageOptions, technicalConnections, currencyOptions]) => {
        setTypes(serviceTypes);
        setPackages(packageOptions);
        setConnections(technicalConnections);
        setCurrencies(currencyOptions);
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Load failed.'));
  }, [canMap]);

  useEffect(() => {
    if (!subscriptionId) return;
    // Loading must flip synchronously here so the modal doesn't briefly render the "create
    // subscription" form before the fetched record replaces it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    refreshEditing(subscriptionId)
      .catch((cause: unknown) =>
        setError(
          cause instanceof Error
            ? cause.message
            : 'Unable to load the requested subscription. It may have been deleted.',
        ),
      )
      .finally(() => setLoading(false));
  }, [subscriptionId, refreshEditing]);

  // Initialize the date/interval controls once the record to edit has actually loaded (create
  // mode's own initial state above already covers create, which never goes through this).
  useEffect(() => {
    if (!editing) return;
    const start = toDateInput(editing.startDate);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStartDateValue(start);
    setOriginalStartDate(start);
    setOriginalIntervalMonths(editing.renewalIntervalMonths);
    setIntervalPreset(presetForMonths(editing.renewalIntervalMonths));
    setCustomMonthsValue(String(editing.renewalIntervalMonths ?? 12));
  }, [editing]);

  // Mode B customer search: same debounced-search pattern already used by the Legacy Import
  // customer combobox, against the same /customers endpoint (search by Customer Code, English
  // name, or Arabic name — all already supported server-side).
  useEffect(() => {
    if (editing || lockedCustomer) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCustomerSearchLoading(true);
    const handle = setTimeout(() => {
      const params = new URLSearchParams({ pageSize: '50' });
      if (customerSearch.trim()) params.set('search', customerSearch.trim());
      void apiRequest<PageResult<CustomerComboboxOption>>(`/customers?${params.toString()}`)
        .then((value) => setCustomerOptions(value.data))
        .catch((cause: unknown) =>
          setError(cause instanceof Error ? cause.message : 'Customer search failed.'),
        )
        .finally(() => setCustomerSearchLoading(false));
    }, 300);
    return () => clearTimeout(handle);
  }, [customerSearch, editing, lockedCustomer]);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? '').trim();

    if (hasIntervalModel && (!startDateValue || !(effectiveIntervalMonths > 0))) {
      setError('Start Date and a positive Renewal Interval are required.');
      return;
    }

    const body: Record<string, unknown> = {
      serviceTypeId: value('serviceTypeId'),
      servicePackageId: value('servicePackageId') || undefined,
      name: value('name'),
      description: value('description') || undefined,
      billingFrequency: value('billingFrequency'),
      contractTermMonths: value('contractTermMonths')
        ? Number(value('contractTermMonths'))
        : undefined,
      identifiers: value('domains')
        .split(/\r?\n/)
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => ({ type: 'DOMAIN', value: entry })),
      priceOverrideReason: value('priceOverrideReason') || undefined,
      supplierCost: value('supplierCost') || undefined,
      sellingPrice: value('sellingPrice'),
      currency: value('currency'),
      providerAutoRenews: value('providerAutoRenews') === 'true',
      graceHours: Number(value('graceHours')),
      status: value('status'),
      notes: value('notes') || undefined,
    };

    if (!editing) {
      // Create: Customer Code is server-generated from whichever real Customer id is used here —
      // the locked customer's id when opened from Customer Details, or the combobox selection.
      const customerId = lockedCustomer?.id ?? selectedCustomerId;
      if (!customerId) {
        setError('Select a Customer.');
        return;
      }
      body.customerId = customerId;
      body.startDate = startDateValue;
      body.renewalIntervalMonths = effectiveIntervalMonths;
      // No `renewalDate` — the server derives it from Start Date + Renewal Interval.
    } else if (hasIntervalModel) {
      // Edit, interval-driven: only send Start Date / Renewal Interval when the user actually
      // changed them, so the backend leaves a historical Renewal Date alone when it should.
      // Never send `renewalDate` directly from this mode — the server recalculates it from
      // whichever of these two changed.
      if (startDateValue !== originalStartDate) body.startDate = startDateValue;
      if (effectiveIntervalMonths !== originalIntervalMonths) {
        body.renewalIntervalMonths = effectiveIntervalMonths;
      }
    } else {
      // Edit, legacy/no-interval-model: preserved exactly as before this task — the subscription
      // predates the Renewal Interval concept, so Start Date and Renewal Date remain independent,
      // directly editable fields with no derivation attempted.
      body.startDate = value('startDate');
      body.renewalDate = value('renewalDate');
    }

    try {
      await apiRequest(`/subscriptions${editing ? `/${editing.id}` : ''}`, {
        method: editing ? 'PATCH' : 'POST',
        body: JSON.stringify(body),
      });
      setError('');
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Save failed.');
    }
  }

  async function deleteSubscription() {
    if (!editing) return;
    if (
      !window.confirm(
        `Permanently delete subscription ${editing.subscriptionCode} (${editing.name})? This cannot be undone.`,
      )
    ) {
      return;
    }
    try {
      await apiRequest(`/subscriptions/${editing.id}`, { method: 'DELETE' });
      setError('');
      onDeleted();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Delete failed.');
    }
  }

  async function addMapping(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? '').trim();
    try {
      const action = value('actionProfile');
      const metadata = value('metadata');
      await apiRequest('/subscription-connections', {
        method: 'POST',
        body: JSON.stringify({
          subscriptionId: editing.id,
          technicalConnectionId: value('technicalConnectionId'),
          remoteIdentifier: value('remoteIdentifier'),
          actionProfile: action ? (JSON.parse(action) as Record<string, unknown>) : undefined,
          metadata: metadata ? (JSON.parse(metadata) as Record<string, unknown>) : undefined,
        }),
      });
      setMessage('Technical mapping added and audited. No external action was executed.');
      await refreshEditing(editing.id);
      event.currentTarget.reset();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Mapping failed.');
    }
  }

  async function toggleMapping(mapping: Mapping) {
    try {
      await apiRequest(`/subscription-connections/${mapping.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: !mapping.active }),
      });
      setMessage('Mapping status changed and audited.');
      if (editing) await refreshEditing(editing.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Update failed.');
    }
  }

  return (
    <Modal
      maxWidth="56rem"
      onClose={onClose}
      title={loading ? 'Loading…' : editing ? `Edit ${editing.name}` : 'Create subscription'}
    >
      <Notice message={error} />
      <Notice message={message} tone="success" />
      {editing && (
        <p className="muted mb-4 text-xs">
          Customer Code: {editing.customer.customerCode} · Subscription Code:{' '}
          {editing.subscriptionCode}
        </p>
      )}
      {!editing && (
        <p className="muted mb-4 text-xs">
          Subscription code will be generated automatically from the selected Customer.
        </p>
      )}
      {loading ? (
        <p className="muted text-sm">Loading subscription…</p>
      ) : (
        <>
          {canManage && (
            <form
              className="form-grid"
              key={editing?.id ?? 'new'}
              onSubmit={(event) => void save(event)}
            >
              {editing ? (
                <div className="field">
                  <span>Customer</span>
                  <strong>
                    {editing.customer.customerCode} · {customerCombinedLabel(editing.customer)}
                  </strong>
                  <small className="muted">
                    Customer is fixed once a subscription is created — its Subscription Code
                    encodes this Customer. Use a Transfer workflow (not available yet) to move it.
                  </small>
                </div>
              ) : lockedCustomer ? (
                <div className="field">
                  <span>Customer</span>
                  <strong>
                    {lockedCustomer.customerCode} · {customerCombinedLabel(lockedCustomer)}
                  </strong>
                  <small className="muted">
                    Locked because this subscription is being added from Customer Details.
                  </small>
                </div>
              ) : (
                <CustomerCombobox
                  loading={customerSearchLoading}
                  onSearchChange={setCustomerSearch}
                  onSelect={(id, label) => {
                    setSelectedCustomerId(id);
                    setSelectedCustomerLabel(label);
                  }}
                  options={customerOptions}
                  placeholder="Search Customer Code, English or Arabic name…"
                  required
                  searchValue={customerSearch}
                  selectedLabel={selectedCustomerLabel}
                  value={selectedCustomerId}
                />
              )}
              <label className="field">
                <span>Service Type</span>
                <select defaultValue={editing?.serviceTypeId ?? ''} name="serviceTypeId" required>
                  <option value="">Select…</option>
                  {types
                    .filter((type) => type.active)
                    .map((type) => (
                      <option key={type.id} value={type.id}>
                        {type.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="field">
                <span>Package</span>
                <select defaultValue={editing?.servicePackageId ?? ''} name="servicePackageId">
                  <option value="">Unclassified</option>
                  {packages
                    .filter((item) => !editing || item.serviceTypeId === editing.serviceTypeId)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} · {item.kind}
                      </option>
                    ))}
                </select>
              </label>
              <Field
                label="Name / sold package snapshot"
                name="name"
                required
                value={editing?.name}
              />
              {hasIntervalModel ? (
                <>
                  <label className="field">
                    <span>Start Date</span>
                    <input
                      onChange={(event) => setStartDateValue(event.target.value)}
                      required
                      type="date"
                      value={startDateValue}
                    />
                  </label>
                  <label className="field">
                    <span>Renewal Interval</span>
                    <select
                      onChange={(event) => setIntervalPreset(event.target.value as IntervalPreset)}
                      value={intervalPreset}
                    >
                      {PRESET_INTERVALS.map((months) => (
                        <option key={months} value={months}>
                          {months} months
                        </option>
                      ))}
                      <option value="CUSTOM">Custom</option>
                    </select>
                  </label>
                  {intervalPreset === 'CUSTOM' && (
                    <label className="field">
                      <span>Custom Renewal Interval (months)</span>
                      <input
                        min={1}
                        onChange={(event) => setCustomMonthsValue(event.target.value)}
                        required
                        type="number"
                        value={customMonthsValue}
                      />
                    </label>
                  )}
                  <div className="field">
                    <span>Next Renewal Date</span>
                    <strong>{previewRenewalDate ? toDateInput(previewRenewalDate.toISOString()) : '—'}</strong>
                    <small className="muted">
                      Automatically calculated from Start Date and Renewal Interval.
                    </small>
                  </div>
                </>
              ) : (
                <>
                  <Field
                    label="Start Date"
                    name="startDate"
                    required
                    type="date"
                    value={toDateInput(editing?.startDate)}
                  />
                  <Field
                    label="Renewal Date"
                    name="renewalDate"
                    required
                    type="date"
                    value={toDateInput(editing?.renewalDate)}
                  />
                  <p className="field-wide muted text-xs">
                    This historical subscription has no Renewal Interval on record, so Start Date
                    and Renewal Date remain independently editable rather than derived.
                  </p>
                </>
              )}
              <label className="field">
                <span>Billing Frequency</span>
                <select
                  defaultValue={editing?.billingFrequency ?? 'ANNUAL'}
                  name="billingFrequency"
                >
                  {['MONTHLY', 'QUARTERLY', 'SEMI_ANNUAL', 'ANNUAL', 'BIENNIAL', 'CUSTOM'].map(
                    (item) => (
                      <option key={item}>{item}</option>
                    ),
                  )}
                </select>
                <small className="muted">
                  Billing Frequency controls how often the customer is billed; it does not change
                  the subscription Renewal Interval.
                </small>
              </label>
              <Field
                label="Historical contract term (months)"
                name="contractTermMonths"
                type="number"
                value={String(editing?.contractTermMonths ?? '')}
              />
              <Field
                label="Supplier cost"
                name="supplierCost"
                type="number"
                value={editing?.supplierCost}
              />
              <Field
                label="Original subscription amount"
                name="sellingPrice"
                required
                type="number"
                value={editing?.sellingPrice}
              />
              <label className="field">
                <span>Original currency</span>
                <select defaultValue={editing?.currency ?? 'JOD'} name="currency" required>
                  {currencies.map((currency) => (
                    <option key={currency.code} value={currency.code}>
                      {currency.code} — {currency.name}
                    </option>
                  ))}
                </select>
              </label>
              {editing?.currentSellingPriceJod && (
                <div className="field">
                  <span>Current JOD equivalent</span>
                  <strong>{editing.currentSellingPriceJod} JOD</strong>
                  <small className="muted">
                    1 {editing.currency} = {editing.currentExchangeRateToJod} JOD
                  </small>
                </div>
              )}
              <label className="field">
                <span>Provider auto-renew</span>
                <select
                  defaultValue={String(editing?.providerAutoRenews ?? true)}
                  name="providerAutoRenews"
                >
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              </label>
              <Field
                label="Grace hours"
                name="graceHours"
                required
                type="number"
                value={String(editing?.graceHours ?? 24)}
              />
              <label className="field">
                <span>Status</span>
                <select defaultValue={editing?.status ?? 'ACTIVE'} name="status">
                  <option>ACTIVE</option>
                  <option>SUSPENDED</option>
                  <option>CLOSED</option>
                </select>
              </label>
              <label className="field field-wide">
                <span>Description</span>
                <textarea defaultValue={editing?.description ?? ''} name="description" rows={2} />
              </label>
              <label className="field field-wide">
                <span>Domains / identifiers (one domain per line)</span>
                <textarea
                  defaultValue={
                    editing?.identifiers
                      .filter((item) => item.type === 'DOMAIN')
                      .map((item) => item.value)
                      .join('\n') ?? ''
                  }
                  name="domains"
                  rows={3}
                />
              </label>
              <label className="field field-wide">
                <span>Price difference / negotiated-price reason</span>
                <textarea
                  defaultValue={editing?.priceOverrideReason ?? ''}
                  name="priceOverrideReason"
                  rows={2}
                />
              </label>
              <label className="field field-wide">
                <span>Notes</span>
                <textarea defaultValue={editing?.notes ?? ''} name="notes" rows={2} />
              </label>
              <div className="field-wide flex gap-3">
                <button className="button-primary" type="submit">
                  Save subscription
                </button>
                <button className="button-secondary" onClick={onClose} type="button">
                  Cancel
                </button>
                {editing && (
                  <button
                    className="button-small danger ml-auto"
                    onClick={() => void deleteSubscription()}
                    type="button"
                  >
                    Delete subscription
                  </button>
                )}
              </div>
            </form>
          )}
          {editing && (
            <div className={canManage ? 'mt-6 border-t border-[var(--line)] pt-5' : undefined}>
              <h3 className="text-lg font-semibold">Technical mappings for {editing.name}</h3>
              <p className="mt-1 text-sm text-[var(--muted)]">
                Mappings are service-specific. Disabling one mapping does not affect unrelated
                subscriptions.
              </p>
              <div className="mt-4 space-y-3">
                {editing.connections.length ? (
                  editing.connections.map((mapping) => (
                    <div
                      className="rounded-xl border border-[var(--line)] p-4 text-sm"
                      key={mapping.id}
                    >
                      <div className="flex flex-wrap justify-between gap-3">
                        <div>
                          <strong>{mapping.technicalConnection.code}</strong> ·{' '}
                          {mapping.remoteIdentifier}
                          <p className="muted">
                            {mapping.technicalConnection.type} ·{' '}
                            {mapping.active ? 'Active' : 'Inactive'}
                          </p>
                        </div>
                        {canMap && (
                          <button
                            className="button-small"
                            onClick={() => void toggleMapping(mapping)}
                            type="button"
                          >
                            {mapping.active ? 'Disable mapping' : 'Enable mapping'}
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="muted text-sm">Zero mappings. This is valid.</p>
                )}
              </div>
              {canMap && (
                <form
                  className="form-grid mt-5 border-t border-[var(--line)] pt-5"
                  onSubmit={(event) => void addMapping(event)}
                >
                  <label className="field">
                    <span>Technical Connection</span>
                    <select name="technicalConnectionId" required>
                      <option value="">Select…</option>
                      {connections
                        .filter((item) => item.enabled)
                        .map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.code} · {item.type}
                          </option>
                        ))}
                    </select>
                  </label>
                  <Field label="Remote identifier" name="remoteIdentifier" required />
                  <label className="field field-wide">
                    <span>Action profile (JSON, configuration only)</span>
                    <textarea defaultValue="{}" name="actionProfile" rows={3} />
                  </label>
                  <label className="field field-wide">
                    <span>Metadata (JSON)</span>
                    <textarea defaultValue="{}" name="metadata" rows={3} />
                  </label>
                  <div className="field-wide">
                    <button className="button-primary" type="submit">
                      Add mapping
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

function Field({
  label,
  name,
  value,
  required,
  type = 'text',
}: {
  label: string;
  name: string;
  value?: string | null;
  required?: boolean;
  type?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        defaultValue={value ?? ''}
        name={name}
        required={required}
        step={type === 'number' ? '0.001' : undefined}
        type={type}
      />
    </label>
  );
}
