'use client';

import { useEffect, useState } from 'react';
import { apiRequest } from '../lib/api';
import { useControlPanel } from './app-shell';
import { Notice } from './notice';
import { PageHeading } from './page-heading';

interface ServiceType {
  id: string;
  name: string;
  active: boolean;
}
interface PackageTerm {
  termMonths: number;
  currency: string;
  standardSellingPrice: string;
}
interface ServicePackage {
  id: string;
  serviceTypeId: string;
  code: string;
  name: string;
  kind: string;
  description: string | null;
  specifications: Record<string, unknown> | null;
  active: boolean;
  serviceType: ServiceType;
  terms: PackageTerm[];
  _count: { subscriptions: number };
}

export function ServicePackagesManager() {
  const { can } = useControlPanel();
  const [items, setItems] = useState<ServicePackage[]>([]);
  const [types, setTypes] = useState<ServiceType[]>([]);
  const [editing, setEditing] = useState<ServicePackage | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function load() {
    const [packages, serviceTypes] = await Promise.all([
      apiRequest<ServicePackage[]>('/service-packages'),
      apiRequest<ServiceType[]>('/service-types'),
    ]);
    setItems(packages);
    setTypes(serviceTypes);
  }
  useEffect(() => {
    void load().catch((cause: unknown) =>
      setError(cause instanceof Error ? cause.message : 'Load failed.'),
    );
  }, []);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? '').trim();
    const terms = value('terms')
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const [months, currency, price] = line.split(',').map((part) => part.trim());
        return { termMonths: Number(months), currency, standardSellingPrice: price };
      });
    const specifications = value('specifications');
    try {
      await apiRequest(`/service-packages${editing ? `/${editing.id}` : ''}`, {
        method: editing ? 'PATCH' : 'POST',
        body: JSON.stringify({
          ...(editing ? {} : { code: value('code') }),
          serviceTypeId: value('serviceTypeId'),
          name: value('name'),
          kind: value('kind'),
          description: value('description') || undefined,
          specifications: specifications ? JSON.parse(specifications) : undefined,
          terms,
          ...(editing ? { active: value('active') === 'true' } : {}),
        }),
      });
      setEditing(null);
      setMessage('Package catalog entry saved and audited.');
      setError('');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Save failed.');
    }
  }

  return (
    <>
      <PageHeading
        title="Package Catalog"
        description="Official offers and custom templates. Catalog prices are references; subscription selling prices remain historical values."
      />
      <Notice message={error} />
      <Notice message={message} tone="success" />
      {can('ADMIN') && (
        <details className="panel mb-6" open={Boolean(editing)}>
          <summary className="cursor-pointer font-semibold">
            {editing ? `Edit ${editing.code}` : 'Create package'}
          </summary>
          <form
            className="form-grid mt-5"
            key={editing?.id ?? 'new'}
            onSubmit={(event) => void save(event)}
          >
            {!editing && <Field label="Code" name="code" required />}
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
            <Field label="Name" name="name" required value={editing?.name} />
            <label className="field">
              <span>Kind</span>
              <select defaultValue={editing?.kind ?? 'STANDARD'} name="kind">
                <option>STANDARD</option>
                <option>ADD_ON</option>
                <option>CUSTOM_TEMPLATE</option>
              </select>
            </label>
            {editing && (
              <label className="field">
                <span>Status</span>
                <select defaultValue={String(editing.active)} name="active">
                  <option value="true">Active</option>
                  <option value="false">Inactive</option>
                </select>
              </label>
            )}
            <label className="field field-wide">
              <span>Description</span>
              <textarea defaultValue={editing?.description ?? ''} name="description" rows={2} />
            </label>
            <label className="field field-wide">
              <span>Specifications (structured JSON)</span>
              <textarea
                defaultValue={JSON.stringify(editing?.specifications ?? {}, null, 2)}
                name="specifications"
                rows={5}
              />
            </label>
            <label className="field field-wide">
              <span>Catalog terms — one per line: months, currency, price</span>
              <textarea
                defaultValue={
                  editing?.terms
                    .map(
                      (term) =>
                        `${term.termMonths}, ${term.currency}, ${term.standardSellingPrice}`,
                    )
                    .join('\n') ?? ''
                }
                name="terms"
                placeholder="12, JOD, 250.000"
                rows={5}
              />
            </label>
            <div className="field-wide flex gap-3">
              <button className="button-primary" type="submit">
                Save package
              </button>
              {editing && (
                <button className="button-secondary" onClick={() => setEditing(null)} type="button">
                  Cancel
                </button>
              )}
            </div>
          </form>
        </details>
      )}
      <section className="panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Package</th>
                <th>Type</th>
                <th>Terms</th>
                <th>Subscriptions</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <strong>{item.name}</strong>
                    <br />
                    <span className="muted text-xs">
                      {item.code} · {item.kind}
                    </span>
                  </td>
                  <td>{item.serviceType.name}</td>
                  <td>
                    {item.terms.length
                      ? item.terms
                          .map(
                            (term) =>
                              `${term.termMonths}m ${term.standardSellingPrice} ${term.currency}`,
                          )
                          .join(' · ')
                      : 'Custom price'}
                  </td>
                  <td>{item._count.subscriptions}</td>
                  <td>
                    <span className="status-pill">{item.active ? 'ACTIVE' : 'INACTIVE'}</span>
                  </td>
                  <td>
                    {can('ADMIN') && (
                      <button
                        className="button-small"
                        onClick={() => setEditing(item)}
                        type="button"
                      >
                        Edit
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
  );
}

function Field({
  label,
  name,
  value,
  required,
}: {
  label: string;
  name: string;
  value?: string;
  required?: boolean;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input defaultValue={value} name={name} required={required} />
    </label>
  );
}
