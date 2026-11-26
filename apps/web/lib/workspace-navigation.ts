type WorkspaceLink = { href: string; label: string; roles: readonly string[]; description?: string };
type SettingsGroup = { title: string; links: readonly WorkspaceLink[] };
const allOperational = ['ADMIN', 'ACCOUNTANT', 'IT', 'SALES_DEVELOPMENT', 'MANAGEMENT'] as const;
const admin = ['ADMIN'] as const;

// Navigation visibility preserves the earlier route audience; the API still owns authorization.
export const settingsGroups: readonly SettingsGroup[] = [
  { title: 'Business', links: [
    { href: '/dashboard/service-types', label: 'Service Types', roles: allOperational, description: 'Categories of billable services.' },
    { href: '/dashboard/packages', label: 'Package Catalog', roles: allOperational, description: 'Reusable subscription packages.' },
    { href: '/dashboard/currencies', label: 'Currencies / Rates', roles: ['ADMIN', 'ACCOUNTANT', 'MANAGEMENT'], description: 'Currencies and recorded exchange rates.' },
    { href: '/dashboard/billing-entities', label: 'Billing Entities', roles: ['ADMIN', 'ACCOUNTANT', 'MANAGEMENT'], description: 'Legal invoice issuers, branding and bank details.' },
  ] },
  { title: 'Renewals', links: [
    { href: '/dashboard/renewal-settings', label: 'Renewal Rules / Reminder Templates', roles: admin, description: 'Configure renewal preparation; customer sending remains manual.' },
  ] },
  { title: 'System / Advanced', links: [
    { href: '/dashboard/access', label: 'Users / Roles', roles: admin, description: 'Individual staff accounts and access.' },
    { href: '/dashboard/technical-connections', label: 'Technical Connections', roles: ['ADMIN', 'IT'], description: 'External system references; mapping does not execute an action.' },
    { href: '/dashboard/legacy-import', label: 'Legacy Import', roles: ['ADMIN', 'ACCOUNTANT', 'SALES_DEVELOPMENT'], description: 'Review and reconcile legacy workbook data.' },
  ] },
];

export const primaryNavigation: readonly WorkspaceLink[] = [
  { href: '/dashboard', label: 'Dashboard', roles: allOperational },
  { href: '/dashboard/customers', label: 'Customers', roles: allOperational },
  { href: '/dashboard/renewals', label: 'Renewals', roles: allOperational },
  { href: '/dashboard/invoices', label: 'Invoices', roles: ['ADMIN', 'ACCOUNTANT'] },
  { href: '/dashboard/communications', label: 'Communications', roles: allOperational },
  { href: '/dashboard/action-queue', label: 'Action / Error Queue', roles: admin },
  { href: '/dashboard/subscriptions', label: 'Subscriptions', roles: allOperational },
  { href: '/dashboard/settings', label: 'Settings', roles: allOperational },
];

export function visibleSettingsGroups(roles: readonly string[]): SettingsGroup[] {
  return settingsGroups.map(group => ({ ...group, links: group.links.filter(link => link.roles.some(role => roles.includes(role))) }))
    .filter(group => group.links.length > 0);
}
export function visiblePrimaryNavigation(roles: readonly string[]): WorkspaceLink[] {
  return primaryNavigation.filter(link => link.roles.some(role => roles.includes(role)));
}
export function canViewIntegrationSettings(roles: readonly string[]): boolean {
  return roles.includes('ADMIN') || roles.includes('IT');
}
function matchesPath(pathname: string, href: string): boolean {
  return pathname === href || (href !== '/dashboard' && pathname.startsWith(`${href}/`));
}
export function isSettingsChild(pathname: string): boolean {
  return settingsGroups.some(group => group.links.some(link => matchesPath(pathname, link.href)));
}
export function isNavigationActive(pathname: string, href: string): boolean {
  return matchesPath(pathname, href) || (href === '/dashboard/settings' && isSettingsChild(pathname));
}
