export interface BilingualCustomerName {
  nameEn: string | null;
  nameAr: string | null;
}

/** English name if present, otherwise Arabic. Both are optional at the schema level, but the
 * service layer never persists a customer with both empty, so one is always available here. */
export function customerDisplayName(customer: BilingualCustomerName): string {
  return customer.nameEn?.trim() || customer.nameAr?.trim() || '';
}
