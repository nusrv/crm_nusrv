export type InvoiceCreateMode = 'SUBSCRIPTION' | 'REGISTERED' | 'ONE_TIME';

export interface InvoiceSourceOption {
  id: string;
  status: string;
  billingEntityId?: string;
}

/** The API remains authoritative for eligibility; the UI never guesses a customer or subscription. */
export function invoiceSourceQuery(mode: InvoiceCreateMode, issuerId: string, search: string): string | null {
  if (mode === 'ONE_TIME' || (mode === 'REGISTERED' && !issuerId)) return null;
  const params = new URLSearchParams({ pageSize: '50', status: 'ACTIVE' });
  if (mode === 'REGISTERED') params.set('billingEntityId', issuerId);
  if (search.trim()) params.set('search', search.trim());
  return `${mode === 'SUBSCRIPTION' ? '/subscriptions' : '/customers'}?${params.toString()}`;
}

export function eligibleInvoiceSource(mode: InvoiceCreateMode, issuerId: string, selected: InvoiceSourceOption | null): boolean {
  if (mode === 'ONE_TIME') return selected === null && Boolean(issuerId);
  if (!selected?.id || selected.status !== 'ACTIVE') return false;
  return mode === 'SUBSCRIPTION' || (Boolean(issuerId) && selected.billingEntityId === issuerId);
}

export function invoiceCreationTarget(mode: InvoiceCreateMode, issuerId: string, selected: InvoiceSourceOption | null): { path: string; identity: { billingEntityId?: string; customerId?: string } } | null {
  if (!eligibleInvoiceSource(mode, issuerId, selected)) return null;
  if (mode === 'SUBSCRIPTION') return { path: `/invoices/from-subscription/${encodeURIComponent(selected!.id)}`, identity: {} };
  return { path: '/invoices/manual-draft', identity: mode === 'REGISTERED'
    ? { billingEntityId: issuerId, customerId: selected!.id }
    : { billingEntityId: issuerId } };
}
