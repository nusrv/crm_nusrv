'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiRequest, type PageResult } from '../lib/api';
import type { CurrencyOption } from './currencies-manager';
import { customerDisplayName } from '../lib/customer-name';
import { useControlPanel } from './app-shell';
import { Notice } from './notice';
import { PageHeading } from './page-heading';
import { SubscriptionModal } from './subscription-modal';

interface SubscriptionRow {
  id: string;
  subscriptionCode: string;
  name: string;
  startDate: string;
  renewalDate: string;
  sellingPrice: string;
  currency: string;
  currentSellingPriceJod: string | null;
  supplierCost: string | null;
  status: string;
  customer: { nameEn: string | null; nameAr: string | null };
  serviceType: { name: string };
  servicePackage: { name: string } | null;
  packageNameSnapshot: string | null;
  classificationStatus: string;
  connections: unknown[];
}

interface ServiceTypeOption {
  id: string;
  name: string;
  active: boolean;
}

interface PackageOption {
  id: string;
  serviceTypeId: string;
  name: string;
  active: boolean;
}

interface BillingEntityOption {
  id: string;
  name: string;
  active: boolean;
}

export function SubscriptionsManager() {
  const { can } = useControlPanel();
  const canManage = can('ADMIN', 'ACCOUNTANT');
  const canMap = can('ADMIN', 'IT');
  const [result, setResult] = useState<PageResult<SubscriptionRow> | null>(null);
  const [defaultCustomerId, setDefaultCustomerId] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [serviceTypeId, setServiceTypeId] = useState('');
  const [servicePackageId, setServicePackageId] = useState('');
  const [billingEntityId, setBillingEntityId] = useState('');
  const [currency, setCurrency] = useState('');
  const [renewalFrom, setRenewalFrom] = useState('');
  const [renewalTo, setRenewalTo] = useState('');
  const [serviceTypes, setServiceTypes] = useState<ServiceTypeOption[]>([]);
  const [packages, setPackages] = useState<PackageOption[]>([]);
  const [billingEntities, setBillingEntities] = useState<BillingEntityOption[]>([]);
  const [currencies, setCurrencies] = useState<CurrencyOption[]>([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    const params = new URLSearchParams({ page: '1', pageSize: '100' });
    if (search) params.set('search', search);
    if (status) params.set('status', status);
    if (serviceTypeId) params.set('serviceTypeId', serviceTypeId);
    if (servicePackageId) params.set('servicePackageId', servicePackageId);
    if (billingEntityId) params.set('billingEntityId', billingEntityId);
    if (currency) params.set('currency', currency);
    if (renewalFrom) params.set('renewalFrom', renewalFrom);
    if (renewalTo) params.set('renewalTo', renewalTo);
    const [
      subscriptionResult,
      serviceTypeResult,
      packageResult,
      billingEntityResult,
      currencyResult,
    ] = await Promise.all([
      apiRequest<PageResult<SubscriptionRow>>(`/subscriptions?${params.toString()}`),
      apiRequest<ServiceTypeOption[]>('/service-types'),
      apiRequest<PackageOption[]>('/service-packages'),
      apiRequest<BillingEntityOption[]>('/billing-entities'),
      apiRequest<CurrencyOption[]>('/currencies'),
    ]);
    setResult(subscriptionResult);
    setServiceTypes(serviceTypeResult);
    setPackages(packageResult);
    setBillingEntities(billingEntityResult);
    setCurrencies(currencyResult);
  }, [
    search,
    status,
    serviceTypeId,
    servicePackageId,
    billingEntityId,
    currency,
    renewalFrom,
    renewalTo,
  ]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const customerId = params.get('customerId') ?? '';
    setDefaultCustomerId(customerId);
    if (customerId) {
      setEditingId(null);
      setFormOpen(true);
    }
    const editParam = params.get('edit');
    if (editParam) {
      setEditingId(editParam);
      setFormOpen(true);
    }
  }, []);

  useEffect(() => {
    void load().catch((cause: unknown) =>
      setError(cause instanceof Error ? cause.message : 'Load failed.'),
    );
  }, [load]);

  function openCreate() {
    setEditingId(null);
    setFormOpen(true);
  }

  function openEdit(id: string) {
    setEditingId(id);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingId(null);
  }

  function handleSaved() {
    closeForm();
    setMessage('Subscription saved and audited.');
    void load();
  }

  const date = (value?: string) => (value ? value.slice(0, 10) : '');

  return (
    <>
      <PageHeading
        title="Subscriptions"
        description="Independent billable services with dates and financial fields. Technical dependencies are mapped separately and do not execute actions in Phase 1."
      />
      <Notice message={error} />
      <Notice message={message} tone="success" />
      {canManage && (
        <div className="mb-4">
          <button className="button-primary" onClick={openCreate} type="button">
            + Create subscription
          </button>
        </div>
      )}
      {formOpen && (
        <SubscriptionModal
          defaultCustomerId={defaultCustomerId}
          onClose={closeForm}
          onSaved={handleSaved}
          subscriptionId={editingId}
        />
      )}
      <section className="panel">
        <div className="toolbar flex flex-wrap items-end gap-3">
          <input
            aria-label="Search subscriptions"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search subscription, name, customer"
            value={search}
          />
          <select
            aria-label="Subscription status"
            onChange={(event) => setStatus(event.target.value)}
            value={status}
          >
            <option value="">All statuses</option>
            <option>ACTIVE</option>
            <option>SUSPENDED</option>
            <option>CLOSED</option>
          </select>
          <select
            aria-label="Service Type filter"
            onChange={(event) => {
              setServiceTypeId(event.target.value);
              setServicePackageId('');
            }}
            value={serviceTypeId}
          >
            <option value="">All service types</option>
            {serviceTypes.map((serviceType) => (
              <option key={serviceType.id} value={serviceType.id}>
                {serviceType.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Package filter"
            onChange={(event) => setServicePackageId(event.target.value)}
            value={servicePackageId}
          >
            <option value="">All packages</option>
            {packages
              .filter((item) => !serviceTypeId || item.serviceTypeId === serviceTypeId)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
          </select>
          <select
            aria-label="Billing Entity filter"
            onChange={(event) => setBillingEntityId(event.target.value)}
            value={billingEntityId}
          >
            <option value="">All Billing Entities</option>
            {billingEntities.map((entity) => (
              <option key={entity.id} value={entity.id}>
                {entity.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Currency filter"
            onChange={(event) => setCurrency(event.target.value)}
            value={currency}
          >
            <option value="">All currencies</option>
            {currencies.map((item) => (
              <option key={item.code} value={item.code}>
                {item.code} — {item.name}
              </option>
            ))}
          </select>
          <label className="field">
            <span>Renewal from</span>
            <input
              aria-label="Renewal from"
              onChange={(event) => setRenewalFrom(event.target.value)}
              type="date"
              value={renewalFrom}
            />
          </label>
          <label className="field">
            <span>Renewal to</span>
            <input
              aria-label="Renewal to"
              onChange={(event) => setRenewalTo(event.target.value)}
              type="date"
              value={renewalTo}
            />
          </label>
          {(search ||
            status ||
            serviceTypeId ||
            servicePackageId ||
            billingEntityId ||
            currency ||
            renewalFrom ||
            renewalTo) && (
            <button
              className="button-small"
              onClick={() => {
                setSearch('');
                setStatus('');
                setServiceTypeId('');
                setServicePackageId('');
                setBillingEntityId('');
                setCurrency('');
                setRenewalFrom('');
                setRenewalTo('');
              }}
              type="button"
            >
              Clear filters
            </button>
          )}
        </div>
        <div className="table-wrap mt-4">
          <table>
            <thead>
              <tr>
                <th>Subscription Code</th>
                <th>Name</th>
                <th>Customer</th>
                <th>Type</th>
                <th>Dates</th>
                <th>Price</th>
                <th>Mappings</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {result?.data.map((subscription) => (
                <tr key={subscription.id}>
                  <td>{subscription.subscriptionCode}</td>
                  <td>{subscription.name}</td>
                  <td>{customerDisplayName(subscription.customer)}</td>
                  <td>
                    {subscription.serviceType.name}
                    <br />
                    <span className="muted text-xs">
                      {subscription.packageNameSnapshot ??
                        subscription.servicePackage?.name ??
                        'Unclassified'}{' '}
                      · {subscription.classificationStatus}
                    </span>
                  </td>
                  <td>
                    {date(subscription.startDate)} → {date(subscription.renewalDate)}
                  </td>
                  <td>
                    {subscription.sellingPrice} {subscription.currency}
                    <br />
                    <span className="muted">
                      Current equivalent {subscription.currentSellingPriceJod ?? 'rate unavailable'}{' '}
                      JOD
                    </span>
                    <br />
                    <span className="muted">Cost {subscription.supplierCost ?? '—'}</span>
                  </td>
                  <td>{subscription.connections.length}</td>
                  <td>{subscription.status}</td>
                  <td>
                    <button
                      className="button-small"
                      onClick={() => openEdit(subscription.id)}
                      type="button"
                    >
                      View{canManage || canMap ? ' / manage' : ''}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
