'use client';

import type { AuthenticatedUser, RoleCode } from '@cp/shared';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../lib/api';

interface ControlPanelContextValue {
  user: AuthenticatedUser;
  can: (...roles: RoleCode[]) => boolean;
}

const ControlPanelContext = createContext<ControlPanelContextValue | null>(null);

const navigation: Array<{ href: string; label: string; roles: RoleCode[] }> = [
  {
    href: '/dashboard',
    label: 'Dashboard',
    roles: ['ADMIN', 'ACCOUNTANT', 'IT', 'SALES_DEVELOPMENT', 'MANAGEMENT'],
  },
  {
    href: '/dashboard/customers',
    label: 'Customers',
    roles: ['ADMIN', 'ACCOUNTANT', 'IT', 'SALES_DEVELOPMENT', 'MANAGEMENT'],
  },
  {
    href: '/dashboard/subscriptions',
    label: 'Subscriptions',
    roles: ['ADMIN', 'ACCOUNTANT', 'IT', 'SALES_DEVELOPMENT', 'MANAGEMENT'],
  },
  {
    href: '/dashboard/renewals',
    label: 'Renewals',
    roles: ['ADMIN', 'ACCOUNTANT', 'IT', 'SALES_DEVELOPMENT', 'MANAGEMENT'],
  },
  {
    href: '/dashboard/renewal-settings',
    label: 'Renewal Settings',
    roles: ['ADMIN'],
  },
  {
    href: '/dashboard/service-types',
    label: 'Service Types',
    roles: ['ADMIN', 'ACCOUNTANT', 'IT', 'SALES_DEVELOPMENT', 'MANAGEMENT'],
  },
  {
    href: '/dashboard/packages',
    label: 'Package Catalog',
    roles: ['ADMIN', 'ACCOUNTANT', 'IT', 'SALES_DEVELOPMENT', 'MANAGEMENT'],
  },
  {
    href: '/dashboard/technical-connections',
    label: 'Technical Connections',
    roles: ['ADMIN', 'IT'],
  },
  {
    href: '/dashboard/billing-entities',
    label: 'Billing Entities',
    roles: ['ADMIN', 'ACCOUNTANT', 'MANAGEMENT'],
  },
  {
    href: '/dashboard/legacy-import',
    label: 'Legacy Import',
    roles: ['ADMIN', 'ACCOUNTANT', 'SALES_DEVELOPMENT'],
  },
  { href: '/dashboard/access', label: 'Users / Roles', roles: ['ADMIN'] },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    void apiRequest<{ user: AuthenticatedUser }>('/auth/me')
      .then((result) => setUser(result.user))
      .catch((cause: unknown) => {
        const message = cause instanceof Error ? cause.message : 'Unable to load session.';
        if (message === 'Authentication required.') router.replace('/login');
        else setError(message);
      });
  }, [router]);

  const value = useMemo<ControlPanelContextValue | null>(
    () =>
      user
        ? {
            user,
            can: (...roles) => roles.some((role) => user.roles.includes(role)),
          }
        : null,
    [user],
  );

  async function logout() {
    await apiRequest<void>('/auth/logout', { method: 'POST' });
    router.replace('/login');
  }

  if (error) return <main className="p-8 text-red-700">{error}</main>;
  if (!user || !value) return <main className="p-8 text-[var(--muted)]">Loading workspace…</main>;

  return (
    <ControlPanelContext.Provider value={value}>
      <div className="min-h-screen lg:grid lg:grid-cols-[270px_1fr]">
        <aside className="border-r border-[var(--line)] bg-white p-5 lg:sticky lg:top-0 lg:h-screen">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">
            Subscription lifecycle
          </p>
          <h1 className="mt-2 text-xl font-semibold">Control Panel</h1>
          <nav className="mt-8 space-y-1" aria-label="Control Panel navigation">
            {navigation
              .filter((item) => item.roles.some((role) => user.roles.includes(role)))
              .map((item) => {
                const active =
                  pathname === item.href ||
                  (item.href !== '/dashboard' && pathname.startsWith(item.href));
                return (
                  <Link
                    className={`nav-link ${active ? 'nav-link-active' : ''}`}
                    href={item.href}
                    key={item.href}
                  >
                    {item.label}
                  </Link>
                );
              })}
          </nav>
          <div className="mt-8 border-t border-[var(--line)] pt-5 text-sm">
            <p className="font-medium">{user.displayName}</p>
            <p className="mt-1 text-xs text-[var(--muted)]">{user.roles.join(', ')}</p>
            <button
              className="button-secondary mt-4 w-full"
              onClick={() => void logout()}
              type="button"
            >
              Sign out
            </button>
          </div>
        </aside>
        <main className="min-w-0 p-5 lg:p-9">{children}</main>
      </div>
    </ControlPanelContext.Provider>
  );
}

export function useControlPanel(): ControlPanelContextValue {
  const value = useContext(ControlPanelContext);
  if (!value) throw new Error('Control Panel context is unavailable.');
  return value;
}
