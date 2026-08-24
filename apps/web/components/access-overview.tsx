'use client';

import { useControlPanel } from './app-shell';
import { PageHeading } from './page-heading';

const matrix = [
  ['Admin', 'Full Phase 1 management, import approval, and secure configuration.'],
  [
    'Accountant',
    'Customer, subscription, Billing Entity, dashboard, and import visibility; subscription management.',
  ],
  [
    'IT',
    'Technical Connection and subscription-to-connection mapping management; operational visibility.',
  ],
  [
    'Sales Development',
    'Customer management, subscription visibility, and legacy row review without approval.',
  ],
  ['Management', 'Dashboard and read-only operational visibility.'],
];

export function AccessOverview() {
  const { user } = useControlPanel();
  return (
    <>
      <PageHeading
        title="Users / Roles"
        description="Phase 0 authentication and role assignments remain authoritative. Phase 1 adds no separate identity store or weakened bypass."
      />
      <section className="panel">
        <h3 className="font-semibold">Current operator</h3>
        <p className="mt-2 text-sm">
          {user.displayName} · {user.email}
        </p>
        <p className="muted mt-1 text-sm">{user.roles.join(', ')}</p>
      </section>
      <section className="panel mt-6 table-wrap">
        <table>
          <thead>
            <tr>
              <th>Role</th>
              <th>Phase 1 access</th>
            </tr>
          </thead>
          <tbody>
            {matrix.map(([role, access]) => (
              <tr key={role}>
                <td>{role}</td>
                <td>{access}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted mt-4 text-sm">
          User creation and role assignment UI were not part of the approved Phase 0 identity
          surface, so this page intentionally documents the enforced role matrix without introducing
          new identity administration.
        </p>
      </section>
    </>
  );
}
