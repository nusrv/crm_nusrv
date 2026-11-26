'use client';

import { useEffect, useState } from 'react';
import { apiRequest } from '../lib/api';
import { useControlPanel } from './app-shell';
import { Modal } from './modal';
import { useModalSave } from '../lib/use-modal-save';
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
  const [formOpen, setFormOpen] = useState(false);
  const saveState = useModalSave();
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
    if (!saveState.begin()) return;
    try {
      const saved = await apiRequest<ServiceType>(`/service-types${editing ? `/${editing.id}` : ''}`, {
        method: editing ? 'PATCH' : 'POST',
        body: JSON.stringify(body),
      });
      setEditing(saved);
      saveState.markSaved();
      setMessage('Service Type saved and audited.');
      setError('');
      await load().catch(() => setError('Saved successfully, but the list could not be refreshed.'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Save failed.');
    } finally {
      saveState.finish();
    }
  }
  return (
    <>
      <PageHeading
        title="Service Types"
        description="Configurable commercial service categories. New categories require no schema or code change."
      />
      {!formOpen && (
        <>
          <Notice message={error} />
          <Notice message={message} tone="success" />
        </>
      )}
      {can('ADMIN') && (
        <div className="mb-4">
          <button
            className="button-primary"
            onClick={() => {
              setEditing(null);
              setError(''); setMessage(''); setFormOpen(true);
            }}
            type="button"
          >
            + Create Service Type
          </button>
        </div>
      )}
      {formOpen && (
        <Modal
          closeDisabled={saveState.busy}
          onClose={() => { if (!saveState.busy) setFormOpen(false); }}
          title={editing ? `Edit ${editing.code}` : 'Create Service Type'}
        >
          <Notice message={error} />
          <Notice message={message} tone="success" />
          <form
            className="form-grid"
            key={`${editing?.id ?? 'new'}:${saveState.revision}`}
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
              <button className="button-primary" disabled={saveState.busy} type="submit">
                Save
              </button>
              <button className="button-secondary" disabled={saveState.busy} onClick={() => setFormOpen(false)} type="button">
                Cancel
              </button>
            </div>
          </form>
        </Modal>
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
                    <button
                      className="button-small"
                      onClick={() => {
                        setEditing(item);
                        setError(''); setMessage(''); setFormOpen(true);
                      }}
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
      </section>
    </>
  );
}
