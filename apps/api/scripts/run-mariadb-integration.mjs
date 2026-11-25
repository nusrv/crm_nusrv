import { spawnSync } from 'node:child_process';
import mariadb from 'mariadb';
import { planLegacyRuns, runLegacyPlan } from './mariadb-integration-plan.mjs';

// Names and loopback URLs alone cannot prove ownership of a server. Provision
// a dedicated disposable instance/account first; additionally refuse any
// non-empty or mismatched schema before starting destructive fixture code.
async function preflight(run) {
  const url = new URL(run.env.MARIADB_TEST_DATABASE_URL);
  const database = url.pathname.slice(1);
  const connection = await mariadb.createConnection({
    host: url.hostname, port: Number(url.port || 3306),
    user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
    database, connectTimeout: 5000, socketTimeout: 10000,
  });
  try {
    const [row] = await connection.query(
      'SELECT DATABASE() AS db_name, (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()) AS table_count',
    );
    if (row?.db_name !== database || Number(row.table_count) !== 0) {
      throw new Error('Expected a freshly provisioned, empty suite schema.');
    }
  } finally {
    await connection.end();
  }
}

try {
  const plan = planLegacyRuns(process.argv.slice(2), process.env);
  const results = await runLegacyPlan(plan, spawnSync, preflight, process.execPath);
  console.log('[legacy-db] Suite summary:', JSON.stringify(results));
  process.exitCode = results.some(({ outcome }) => outcome !== 'PASSED') ? 1 : 0;
} catch {
  console.error('[legacy-db] Invalid rehearsal configuration. Use --suite <id> or MARIADB_TEST_SUITE_URLS. Never reuse a test schema.');
  process.exitCode = 1;
}
