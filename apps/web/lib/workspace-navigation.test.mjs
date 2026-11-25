import test from 'node:test';
import assert from 'node:assert/strict';
import { visibleSettingsGroups, visiblePrimaryNavigation, canViewIntegrationSettings, isSettingsChild, isNavigationActive } from './workspace-navigation.ts';
const links = role => visibleSettingsGroups([role]).flatMap(group => group.links.map(link => link.href));

test('ADMIN sees eight daily/navigation entries and eight configuration destinations', () => {
  assert.equal(visiblePrimaryNavigation(['ADMIN']).length, 8);
  assert.equal(links('ADMIN').length, 8);
  assert.ok(canViewIntegrationSettings(['ADMIN']));
});
test('legacy role audiences remain constrained to their existing settings destinations', () => {
  assert.deepEqual(links('IT'), ['/dashboard/service-types', '/dashboard/packages', '/dashboard/technical-connections']);
  assert.deepEqual(links('ACCOUNTANT'), ['/dashboard/service-types', '/dashboard/packages', '/dashboard/currencies', '/dashboard/billing-entities', '/dashboard/legacy-import']);
  assert.deepEqual(links('SALES_DEVELOPMENT'), ['/dashboard/service-types', '/dashboard/packages', '/dashboard/legacy-import']);
  assert.deepEqual(links('MANAGEMENT'), ['/dashboard/service-types', '/dashboard/packages', '/dashboard/currencies', '/dashboard/billing-entities']);
  assert.equal(canViewIntegrationSettings(['ACCOUNTANT']), false);
  assert.equal(canViewIntegrationSettings(['IT']), true);
});
test('no role gives no configuration links and no operational navigation', () => {
  assert.deepEqual(visibleSettingsGroups([]), []);
  assert.deepEqual(visiblePrimaryNavigation(['UNKNOWN']), []);
  assert.equal(canViewIntegrationSettings([]), false);
});
test('settings child highlights settings, not unrelated pages', () => {
  assert.ok(isSettingsChild('/dashboard/billing-entities'));
  assert.ok(isNavigationActive('/dashboard/renewal-settings', '/dashboard/settings'));
  assert.ok(!isNavigationActive('/dashboard/renewal-settings', '/dashboard/renewals'));
  assert.ok(!isNavigationActive('/dashboard/customers', '/dashboard'));
  assert.ok(isNavigationActive('/dashboard/invoices/example', '/dashboard/invoices'));
  assert.ok(!isNavigationActive('/dashboard/settings-extra', '/dashboard/settings'));
});
