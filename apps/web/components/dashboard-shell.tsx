'use client';

import type { AuthenticatedUser, RoleCode } from '@cp/shared';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

const navigation: Array<{ label: string; roles: RoleCode[] }> = [
  { label: 'Overview', roles: ['ADMIN', 'ACCOUNTANT', 'IT', 'SALES_DEVELOPMENT', 'MANAGEMENT'] },
  { label: 'Customers', roles: ['ADMIN', 'ACCOUNTANT', 'IT', 'SALES_DEVELOPMENT', 'MANAGEMENT'] },
  {
    label: 'Subscriptions',
    roles: ['ADMIN', 'ACCOUNTANT', 'IT', 'SALES_DEVELOPMENT', 'MANAGEMENT'],
  },
  { label: 'Financial approvals', roles: ['ADMIN', 'ACCOUNTANT'] },
  { label: 'Technical approvals', roles: ['ADMIN', 'IT'] },
  { label: 'Retention', roles: ['ADMIN', 'SALES_DEVELOPMENT', 'MANAGEMENT'] },
  { label: 'Configuration', roles: ['ADMIN'] },
];

export function DashboardShell() {
  const router = useRouter();
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    void fetch(`${apiUrl}/api/v1/auth/me`, { credentials: 'include' }).then(async (response) => {
      if (response.status === 401) {
        router.replace('/login');
        return;
      }
      if (!response.ok) {
        setError('The API foundation is unavailable.');
        return;
      }
      const result = (await response.json()) as { user: AuthenticatedUser };
      setUser(result.user);
    });
  }, [router]);

  const visibleNavigation = useMemo(
    () => navigation.filter((item) => user && item.roles.some((role) => user.roles.includes(role))),
    [user],
  );

  if (error) return <main className="p-8 text-red-700">{error}</main>;
  if (!user)
    return <main className="p-8 text-[var(--muted)]">Loading authenticated workspace…</main>;

  return (
    <main className="min-h-screen lg:grid lg:grid-cols-[260px_1fr]">
      <aside className="border-r border-[var(--line)] bg-white p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">
          Subscription lifecycle
        </p>
        <h1 className="mt-2 text-xl font-semibold">Control Panel</h1>
        <nav className="mt-10 space-y-2" aria-label="Role-based navigation">
          {visibleNavigation.map((item, index) => (
            <span
              className={`block rounded-xl px-4 py-3 text-sm ${
                index === 0
                  ? 'bg-[var(--accent-soft)] font-semibold text-[var(--accent)]'
                  : 'text-[var(--muted)]'
              }`}
              key={item.label}
            >
              {item.label}
            </span>
          ))}
        </nav>
      </aside>
      <section className="p-6 lg:p-10">
        <header className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm text-[var(--muted)]">Signed in as {user.displayName}</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight">Foundation ready</h2>
          </div>
          <span className="rounded-full border border-[var(--line)] bg-white px-4 py-2 text-xs font-semibold">
            Phase 0
          </span>
        </header>
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {[
            ['Authenticated shell', 'Secure cookie-based JWT session foundation'],
            ['RBAC navigation', user.roles.join(', ')],
            ['Business automation', 'Intentionally not started'],
          ].map(([title, detail]) => (
            <article className="rounded-2xl border border-[var(--line)] bg-white p-6" key={title}>
              <h3 className="font-semibold">{title}</h3>
              <p className="mt-3 text-sm leading-6 text-[var(--muted)]">{detail}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
