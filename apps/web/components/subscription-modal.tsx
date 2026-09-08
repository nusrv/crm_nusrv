'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiRequest, type PageResult } from '../lib/api';
import { useControlPanel } from './app-shell';
import type { CurrencyOption } from './currencies-manager';
import { Modal } from './modal';
import { Notice } from './notice';

interface CustomerOption {
  id: string;
  customerCode: string;
  companyName: string;
}
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
  customer: CustomerOption;
  serviceType: ServiceTypeOption;
  servicePackage: PackageOption | null;
  packageNameSnapshot: string | null;
  classificationStatus: string;
  priceOverrideReason: string | null;
  identifiers: SubscriptionIdentifier[];
  connections: Mapping[];
}

/**
 * Shared "create / view / manage" subscription popup. Used both by the Subscriptions list page
 * and by any other page (e.g. customer detail) that wants to show a single subscription without
 * navigating away.
 */
export function SubscriptionModal({
  subscriptionId,
  defaultCustomerId,
  onClose,
  onSaved,
}: {
  subscriptionId: string | null;
  defaultCustomerId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { can } = useControlPanel();
  const canManage = can('ADMIN', 'ACCOUNTANT');
  const canMap = can('ADMIN', 'IT');
  const [editing, setEditing] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(Boolean(subscriptionId));
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [types, setTypes] = useState<ServiceTypeOption[]>([]);
  const [packages, setPackages] = useState<PackageOption[]>([]);
  const [connections, setConnections] = useState<ConnectionOption[]>([]);
  const [currencies, setCurrencies] = useState<CurrencyOption[]>([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const refreshEditing = useCallback(async (id: string) => {
    setEditing(await apiRequest<Subscription>(`/subscriptions/${id}`));
  }, []);

  useEffect(() => {
    void Promise.all([
      apiRequest<PageResult<CustomerOption>>('/customers?pageSize=500'),
      apiRequest<ServiceTypeOption[]>('/service-types'),
      apiRequest<PackageOption[]>('/service-packages?active=true'),
      canMap ? apiRequest<ConnectionOption[]>('/technical-connections') : Promise.resolve([]),
      apiRequest<CurrencyOption[]>('/currencies?active=true'),
    ])
      .then(
        ([customerPage, serviceTypes, packageOptions, technicalConnections, currencyOptions]) => {
          setCustomers(customerPage.data);
          setTypes(serviceTypes);
          setPackages(packageOptions);
          setConnections(technicalConnections);
          setCurrencies(currencyOptions);
        },
      )
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

  const date = (value?: string) => (value ? value.slice(0, 10) : '');

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? '').trim();
    const body = {
      ...(editing ? {} : { subscriptionCode: value('subscriptionCode') }),
      customerId: value('customerId'),
      serviceTypeId: value('serviceTypeId'),
      servicePackageId: value('servicePackageId') || undefined,
      name: value('name'),
      description: value('description') || undefined,
      startDate: value('startDate'),
      renewalDate: value('renewalDate'),
      billingFrequency: value('billingFrequency'),
      renewalIntervalMonths: Number(value('renewalIntervalMonths')),
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
      title={
        loading ? 'Loading…' : editing ? `Edit ${editing.subscriptionCode}` : 'Create subscription'
      }
    >
      <Notice message={error} />
      <Notice message={message} tone="success" />
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
              {!editing && <Field label="Subscription code" name="subscriptionCode" required />}
              <label className="field">
                <span>Customer</span>
                <select
                  defaultValue={editing?.customerId ?? defaultCustomerId ?? ''}
                  name="customerId"
                  required
                >
                  <option value="">Select…</option>
                  {customers.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.customerCode} · {customer.companyName}
                    </option>
                  ))}
                </select>
              </label>
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
              <Field
                label="Start date"
                name="startDate"
                required
                type="date"
                value={date(editing?.startDate)}
              />
              <Field
                label="Renewal date"
                name="renewalDate"
                required
                type="date"
                value={date(editing?.renewalDate)}
              />
              <label className="field">
                <span>Billing frequency</span>
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
              </label>
              <label className="field">
                <span>Renewal interval</span>
                <select
                  defaultValue={String(editing?.renewalIntervalMonths ?? 12)}
                  name="renewalIntervalMonths"
                >
                  <option value="12">12 months</option>
                  <option value="24">24 months</option>
                  <option value="36">36 months</option>
                  <option value="60">60 months</option>
                  {editing?.renewalIntervalMonths &&
                    ![12, 24, 36, 60].includes(editing.renewalIntervalMonths) && (
                      <option value={editing.renewalIntervalMonths}>
                        Custom: {editing.renewalIntervalMonths} months
                      </option>
                    )}
                </select>
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
              </div>
            </form>
          )}
          {editing && (
            <div className={canManage ? 'mt-6 border-t border-[var(--line)] pt-5' : undefined}>
              <h3 className="text-lg font-semibold">
                Technical mappings for {editing.subscriptionCode}
              </h3>
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
