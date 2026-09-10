import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// The single source of truth for "every migration in order" that live-MariaDB test suites testing
// CURRENT application behavior must apply to their disposable database. Each hardcoded, manually
// duplicated migration-name array was a real drift risk: a suite frozen at an old list still
// exercises current production code (current generated Prisma Client, current services) against a
// schema missing every migration added since that list was last updated by hand.
//
// Directory names are `YYYYMMDDHHMMSS_description`, so a plain lexicographic sort is already
// chronological order — no separate ordering metadata is needed.
//
// This intentionally does NOT belong to suites that test one specific historical migration
// boundary on purpose (see mariadb-subscription-code-backfill-live.spec.ts's own `priorMigrations`
// list, which stops deliberately short of its target migration to prove that migration's effect in
// isolation) — those suites' narrow scope is the point, not drift.
export function readAllMigrationsSql(): string {
  const migrationsDir = join(process.cwd(), 'prisma', 'migrations');
  const directories = readdirSync(migrationsDir)
    .filter((entry) => statSync(join(migrationsDir, entry)).isDirectory())
    .sort();
  return directories
    .map((directory) => readFileSync(join(migrationsDir, directory, 'migration.sql'), 'utf8'))
    .join('\n');
}
