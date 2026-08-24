'use client';

import { useEffect, useState } from 'react';
import { apiRequest } from '../lib/api';
import { useControlPanel } from './app-shell';
import { Notice } from './notice';
import { PageHeading } from './page-heading';

interface ServiceType {
  id: string;
  code: string;
  name: string;
  description: string | null;
  active: boolean;
  _count: { subscriptions: number };
}

export function ServiceTypesManager() {
  const { can } = useControlPanel();
  const [items, setItems] = useState<ServiceType[]>([]);
  const [editing, setEditing] = useState<ServiceType | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  async function load() {
    setItems(await apiRequest<ServiceType[]>('/service-types'));
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
    const body = {
      ...(editing ? {} : { code: value('code') }),
      name: value('name'),
      description: value('description') || undefined,
      ...(editing ? { active: value('active') === 'true' } : {}),
    };
    try {
      await apiRequest(`/service-types${editing ? `/${editing.id}` : ''}`, {
        method: editing ? 'PATCH' : 'POST',
        body: JSON.stringify(body),
      });
      setEditing(null);
      setMessage('Service Type saved and audited.');
      setError('');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Save failed.');
    }
  }
  return (
    <>
      <PageHeading
        title="Service Types"
        description="Configurable commercial service categories. New categories require no schema or code change."
      />
      <Notice message={error} />
      <Notice message={message} tone="success" />
      {can('ADMIN') && (
        <details className="panel mb-6" open={Boolean(editing)}>
          <summary className="cursor-pointer font-semibold">
            {editing ? `Edit ${editing.code}` : 'Create Service Type'}
          </summary>
          <form
            className="form-grid mt-5"
            key={editing?.id ?? 'new'}
            onSubmit={(event) => void save(event)}
          >
            {!editing && (
              <label className="field">
                <span>Code</span>
                <input name="code" required />
              </label>
            )}
            <label className="field">
              <span>Name</span>
              <input defaultValue={editing?.name ?? ''} name="name" required />
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
              <textarea defaultValue={editing?.description ?? ''} name="description" rows={3} />
            </label>
            <div className="field-wide flex gap-3">
              <button className="button-primary" type="submit">
                Save
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
      <section className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Description</th>
              <th>Subscriptions</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>{item.code}</td>
                <td>{item.name}</td>
                <td>{item.description}</td>
                <td>{item._count.subscriptions}</td>
                <td>{item.active ? 'ACTIVE' : 'INACTIVE'}</td>
                <td>
                  {can('ADMIN') && (
                    <button className="button-small" onClick={() => setEditing(item)} type="button">
                      Edit
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
