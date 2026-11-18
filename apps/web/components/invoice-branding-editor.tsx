'use client';
import { useEffect, useState } from 'react';
import { INVOICE_DETAIL_KEYS, type InvoiceDetails, type InvoiceVisibility } from '@cp/shared';
import { apiRequest } from '../lib/api';
import { useControlPanel } from './app-shell';
import { InvoiceVisibilityEditor } from './invoice-visibility-editor';
import { BRANDING_PRESETS } from './invoice-branding-presets';
const detailLabels: Record<string, string> = {
  countryName: 'Country display name',
  phone: 'Phone',
  fax: 'Fax',
  website: 'Website',
  bankName: 'Bank name',
  bankBranch: 'Bank branch',
  swift: 'SWIFT',
  jodAccount: 'JOD account number',
  jodIban: 'JOD IBAN',
  usdAccount: 'USD account number',
  usdIban: 'USD IBAN',
  eurAccount: 'EUR account number',
  eurIban: 'EUR IBAN',
};
interface BrandingView {
  billingEntityId: string;
  code: string;
  issuerType: 'COMPANY' | 'INDIVIDUAL';
  legalName: string;
  legalNameAr: string | null;
  address: string | null;
  countryCode: string | null;
  taxNumber: string | null;
  invoiceEmail: string | null;
  expectedRevision: number;
  details: InvoiceDetails;
  visibility: InvoiceVisibility;
  logoAssetId: string | null;
  logoDataUrl: string | null;
}
export function InvoiceBrandingEditor({
  entityId,
  onSaved,
}: {
  entityId: string;
  onSaved: () => Promise<void>;
}) {
  const { can } = useControlPanel();
  const [value, setValue] = useState<BrandingView | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void apiRequest<BrandingView>(`/billing-entities/${entityId}/invoice-branding`)
      .then(setValue)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Unable to load branding.'));
  }, [entityId]);
  async function upload(file: File) {
    const form = new FormData();
    form.append('file', file);
    return apiRequest<{ id: string }>(`/billing-entities/${entityId}/invoice-branding/logos`, {
      method: 'POST',
      body: form,
    });
  }
  async function uploadLogoFile(file: File) {
    setBusy(true);
    try {
      const asset = await upload(file);
      const preview = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Cannot read PNG.'));
        reader.readAsDataURL(file);
      });
      setValue((v) => (v ? { ...v, logoAssetId: asset.id, logoDataUrl: preview } : v));
      setMessage('Logo version uploaded. Save profile to use it on new invoices.');
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed.');
    } finally {
      setBusy(false);
    }
  }
  async function preset() {
    if (!value) return;
    const reference = BRANDING_PRESETS[value.code];
    if (
      !reference ||
      !window.confirm(
        'Load approved branding into this form for review? Saving will update this issuer master identity and defaults. Tax number remains unchanged.',
      )
    )
      return;
    setBusy(true);
    try {
      const response = await fetch(reference.logoUrl);
      if (!response.ok) throw new Error('Approved logo reference unavailable.');
      const file = new File([await response.blob()], 'approved-logo.png', { type: 'image/png' });
      const asset = await upload(file);
      const { logoUrl, ...defaults } = reference;
      setValue({ ...value, ...defaults, logoAssetId: asset.id, logoDataUrl: logoUrl });
      setMessage(
        'Review all reference fields and save explicitly. Tax/national number was not inferred.',
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reference failed.');
    } finally {
      setBusy(false);
    }
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!value) return;
    setBusy(true);
    try {
      const {
        billingEntityId: ignoredEntity,
        code: ignoredCode,
        logoDataUrl: ignoredPreview,
        ...body
      } = value;
      void ignoredEntity;
      void ignoredCode;
      void ignoredPreview;
      const saved = await apiRequest<BrandingView>(
        `/billing-entities/${entityId}/invoice-branding`,
        { method: 'PUT', body: JSON.stringify(body) },
      );
      setValue(saved);
      await onSaved();
      setError('');
      setMessage(
        'Issuer identity and branding defaults saved and audited. Existing invoices are unchanged.',
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed.');
    } finally {
      setBusy(false);
    }
  }
  if (!value) return <p>{error || 'Loading branding...'}</p>;
  const admin = can('ADMIN');
  return (
    <section className="panel">
      <h2>Invoice issuer and presentation</h2>
      <p>
        Legal identity belongs to this Billing Entity. Defaults apply only when creating new
        invoices. Personal invoices use a customer assigned to the personal Billing Entity and an
        ACTIVE subscription.
      </p>
      <p role="alert">{error}</p>
      <p>{message}</p>
      {admin && BRANDING_PRESETS[value.code] && (
        <button
          type="button"
          className="button-secondary"
          onClick={() => void preset()}
          disabled={busy}
        >
          Load approved issuer reference for review
        </button>
      )}
      <form onSubmit={save} className="form-grid">
        <label>
          Issuer type
          <select
            disabled={!admin}
            value={value.issuerType}
            onChange={(e) =>
              setValue({ ...value, issuerType: e.target.value as BrandingView['issuerType'] })
            }
          >
            <option value="COMPANY">Company / Organization</option>
            <option value="INDIVIDUAL">Individual / Personal</option>
          </select>
        </label>
        {(
          [
            'legalName',
            'legalNameAr',
            'address',
            'countryCode',
            'taxNumber',
            'invoiceEmail',
          ] as const
        ).map((k) => (
          <label key={k}>
            {
              {
                legalName:
                  value.issuerType === 'INDIVIDUAL'
                    ? 'Full display/legal name'
                    : 'Full legal name EN',
                legalNameAr: 'Arabic name (optional)',
                address: 'Address',
                countryCode: 'Country ISO code (e.g. JO)',
                taxNumber: 'Authoritative tax / national number',
                invoiceEmail: 'Email',
              }[k]
            }
            <input
              disabled={!admin}
              required={k === 'legalName'}
              value={value[k] ?? ''}
              onChange={(e) =>
                setValue({
                  ...value,
                  [k]: k === 'legalName' ? e.target.value : e.target.value || null,
                })
              }
            />
          </label>
        ))}
        {INVOICE_DETAIL_KEYS.map((k) => (
          <label key={k}>
            {detailLabels[k]}
            <input
              disabled={!admin}
              value={value.details[k] ?? ''}
              onChange={(e) =>
                setValue({ ...value, details: { ...value.details, [k]: e.target.value } })
              }
            />
          </label>
        ))}
        <div className="field-wide">
          {value.logoDataUrl && (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={value.logoDataUrl}
                alt="Issuer logo preview"
                style={{ maxWidth: 220, maxHeight: 100 }}
              />
            </>
          )}
          {admin && (
            <>
              <label>
                Optional PNG logo (maximum 256 KB, 4096px)
                <input
                  type="file"
                  accept="image/png"
                  disabled={busy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void uploadLogoFile(file);
                    e.target.value = '';
                  }}
                />
              </label>
              <button
                type="button"
                onClick={() => setValue({ ...value, logoAssetId: null, logoDataUrl: null })}
              >
                Remove current logo from profile
              </button>
            </>
          )}
        </div>
        <div className="field-wide">
          <InvoiceVisibilityEditor
            value={value.visibility}
            onChange={(visibility) => setValue({ ...value, visibility })}
            readOnly={!admin}
          />
        </div>
        {admin && (
          <button className="button-primary" disabled={busy} type="submit">
            Save issuer profile
          </button>
        )}
      </form>
    </section>
  );
}
