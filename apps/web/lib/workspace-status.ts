/** Display labels only: API filter and transition values remain untouched. */
const labels: Record<string, string> = {
  AWAITING_CUSTOMER: 'Waiting for Customer', HUMAN_REVIEW: 'Needs Review',
  UPCOMING: 'Upcoming', REMINDER_CYCLE: 'Reminder Cycle', ACCEPTED: 'Accepted',
  DO_NOT_RENEW: 'Do Not Renew', FULFILLED: 'Fulfilled',
  READY_FOR_FAWTARA: 'Ready to Record Official Invoice', FAWTARA_ACCEPTED: 'Official Invoice Recorded',
  FAWTARA_REJECTED: 'Official Invoice Rejected', INVOICE_PENDING_PUBLICATION: 'Invoice Pending',
  PAYMENT_REPORTED: 'Payment Reported', PAYMENT_CONFIRMED: 'Payment Confirmed',
  PARTIALLY_PAID: 'Partially Paid', UNPAID: 'Unpaid', PAID: 'Paid',
  REVIEW_ONLY: 'Unverified Report — Review Only',
};
export function workspaceStatus(value: string): string {
  return Object.hasOwn(labels, value) ? labels[value]! : value.toLowerCase().split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}
export function mailDispatchStatus(value: string, uncertain = false): string {
  if (uncertain) return 'Dispatch uncertain — review required';
  if (value === 'DELIVERED') return 'Dispatch recorded — delivery not verified';
  if (value === 'UNKNOWN') return 'Delivery not verified';
  return workspaceStatus(value);
}
