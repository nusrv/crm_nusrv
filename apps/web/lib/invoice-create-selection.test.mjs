import test from 'node:test';
import assert from 'node:assert/strict';
import { invoiceSourceQuery, eligibleInvoiceSource, invoiceCreationTarget } from './invoice-create-selection.ts';
const active = { id: 'customer-1', status: 'ACTIVE', billingEntityId: 'issuer-1' };

test('registered customer search is scoped to active customers of selected issuer', () => {
  assert.equal(invoiceSourceQuery('REGISTERED', 'issuer-1', ' Arabic & English '), '/customers?pageSize=50&status=ACTIVE&billingEntityId=issuer-1&search=Arabic+%26+English');
  assert.equal(invoiceSourceQuery('REGISTERED', '', ''), null);
  assert.equal(invoiceSourceQuery('ONE_TIME', 'issuer-1', ''), null);
});
test('subscription search has only active subscriptions and no fabricated issuer', () => {
  assert.equal(invoiceSourceQuery('SUBSCRIPTION', '', 'domain'), '/subscriptions?pageSize=50&status=ACTIVE&search=domain');
});
test('registered draft sends actual registered customer identity and no subscription', () => {
  assert.deepEqual(invoiceCreationTarget('REGISTERED', 'issuer-1', active), { path: '/invoices/manual-draft', identity: { billingEntityId: 'issuer-1', customerId: 'customer-1' } });
});
test('inactive, stale issuer and missing selections fail closed', () => {
  assert.equal(invoiceCreationTarget('REGISTERED', 'issuer-2', active), null);
  assert.equal(invoiceCreationTarget('REGISTERED', 'issuer-1', { ...active, status: 'INACTIVE' }), null);
  assert.equal(invoiceCreationTarget('SUBSCRIPTION', '', null), null);
  assert.equal(eligibleInvoiceSource('ONE_TIME', 'issuer-1', active), false);
});
test('one-time and subscription use distinct paths without fabricated customer or renewal', () => {
  assert.deepEqual(invoiceCreationTarget('ONE_TIME', 'issuer-1', null), { path: '/invoices/manual-draft', identity: { billingEntityId: 'issuer-1' } });
  assert.deepEqual(invoiceCreationTarget('SUBSCRIPTION', '', { id: 'subscription/1', status: 'ACTIVE' }), { path: '/invoices/from-subscription/subscription%2F1', identity: {} });
});
