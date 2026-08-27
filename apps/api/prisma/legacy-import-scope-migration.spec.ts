import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('legacy import active-sheet scope migration', () => {
  const migration = readFileSync(
    join(
      process.cwd(),
      'prisma',
      'migrations',
      '20260827010000_scope_legacy_import_active_sheet',
      'migration.sql',
    ),
    'utf8',
  );

  it('preserves non-active rows while moving them out of manual review', () => {
    expect(migration).toContain("`status` = 'SKIPPED'");
    expect(migration).toContain("`sheet_name` <> 'Active_Subscriptions'");
    expect(migration).toContain("`status` IN ('STAGED', 'REQUIRES_MANUAL_REVIEW')");
    expect(migration).toContain('legacy_import.scope_reconciled');
    expect(migration).toContain('JSON_ARRAY');
  });

  it('is additive and never removes staged source data', () => {
    expect(migration).not.toMatch(/DELETE|DROP|TRUNCATE/i);
  });
});
