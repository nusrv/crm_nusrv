export interface BilingualCustomerName {
  nameEn?: string | null;
  nameAr?: string | null;
}

/** The name to lead with: English if present, otherwise Arabic. */
export function customerDisplayName(customer: BilingualCustomerName): string {
  return customer.nameEn?.trim() || customer.nameAr?.trim() || '';
}

/** The other name, only when both are present — for showing as a muted second line. */
export function customerSecondaryName(customer: BilingualCustomerName): string | null {
  const nameEn = customer.nameEn?.trim();
  const nameAr = customer.nameAr?.trim();
  return nameEn && nameAr ? nameAr : null;
}

/** Both names on one line (for `<option>` text and other places that can't do two lines). */
export function customerCombinedLabel(customer: BilingualCustomerName): string {
  const nameEn = customer.nameEn?.trim();
  const nameAr = customer.nameAr?.trim();
  if (nameEn && nameAr) return `${nameEn} / ${nameAr}`;
  return nameEn || nameAr || '';
}
