'use client';
import {
  INVOICE_VISIBILITY_KEYS,
  OFFICIAL_PRINT_REQUIRED,
  effectiveInvoiceVisibility,
  type InvoiceVisibility,
} from '@cp/shared';
const labels: Record<string, string> = {
  logo: 'Logo',
  nameEn: 'English / legal name',
  nameAr: 'Arabic name',
  address: 'Address',
  country: 'Country',
  taxNumber: 'Tax / National number',
  phone: 'Phone',
  fax: 'Fax',
  email: 'Email',
  website: 'Website',
  bankName: 'Bank name',
  bankBranch: 'Bank branch',
  swift: 'SWIFT',
  jodBank: 'JOD account / IBAN',
  usdBank: 'USD account / IBAN',
  eurBank: 'EUR account / IBAN',
};
export function InvoiceVisibilityEditor({
  value,
  onChange,
  official = false,
  readOnly = false,
}: {
  value: InvoiceVisibility;
  onChange: (v: InvoiceVisibility) => void;
  official?: boolean;
  readOnly?: boolean;
}) {
  const shown = effectiveInvoiceVisibility(value, official);
  return (
    <fieldset className="branding-visibility">
      <legend>Print visibility</legend>
      <p>
        Presentation only. Required JoFotara data is always retained. Seller name, address and
        identifier are enforced on official invoices.
      </p>
      {INVOICE_VISIBILITY_KEYS.map((k) => {
        const required = (OFFICIAL_PRINT_REQUIRED as readonly string[]).includes(k);
        return (
          <label key={k}>
            <input
              type="checkbox"
              checked={shown[k]}
              disabled={readOnly || (official && required)}
              onChange={(e) => onChange({ ...value, [k]: e.target.checked })}
            />
            {labels[k]}
            {required && <small> Required for official invoice</small>}
          </label>
        );
      })}
    </fieldset>
  );
}
