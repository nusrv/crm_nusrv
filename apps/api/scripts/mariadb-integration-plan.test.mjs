import assert from 'node:assert/strict';
import test from 'node:test';
import { CHILD_TIMEOUT_MS, LEGACY_SUITES, SUITE_IDS, planLegacyRuns, runLegacyPlan } from './mariadb-integration-plan.mjs';

const target = (id) => 'mysql://fixture:fixture-only@127.0.0.1:3306/nusrv_legacy_' + id + '_test';
const single = (id) => ({ DATABASE_URL: target(id), MARIADB_TEST_DATABASE_URL: target(id) });
const all = () => Object.fromEntries(SUITE_IDS.map((id) => [id, target(id)]));

test('one suite uses its dedicated target and exact Jest path, with mail disabled', () => {
  const [run] = planLegacyRuns(['--suite', 'phase3c'], { ...single('phase3c'), SMTP_MODE: 'real', IMAP_MODE: 'real', AI_PROVIDER: 'real' });
  assert.equal(run.id, 'phase3c');
  assert.equal(run.args.at(-1), LEGACY_SUITES.phase3c);
  assert.ok(run.args.includes('--runTestsByPath'));
  assert.equal(run.env.DATABASE_URL, run.env.MARIADB_TEST_DATABASE_URL);
  assert.equal(run.env.SMTP_MODE, 'none');
  assert.equal(run.env.IMAP_MODE, 'none');
  assert.equal(run.env.AI_PROVIDER, 'mock');
});

test('full legacy run preserves all ten suites with distinct targets', () => {
  const plan = planLegacyRuns([], { MARIADB_TEST_SUITE_URLS: JSON.stringify(all()) });
  assert.equal(plan.length, 10);
  assert.equal(new Set(plan.map((run) => run.env.DATABASE_URL)).size, 10);
  assert.equal(new Set(plan.map((run) => run.args.at(-1))).size, 10);
  assert.ok(plan.every((run) => !('MARIADB_TEST_SUITE_URLS' in run.env)));
});

test('rejects shared, missing, non-loopback, privileged and mismatched URL configurations', () => {
  assert.throws(() => planLegacyRuns([], single('core')));
  assert.throws(() => planLegacyRuns([], { MARIADB_TEST_SUITE_URLS: JSON.stringify({ ...all(), phase3c: target('core') }) }));
  const missing = all(); delete missing.phase3e;
  assert.throws(() => planLegacyRuns([], { MARIADB_TEST_SUITE_URLS: JSON.stringify(missing) }));
  assert.throws(() => planLegacyRuns(['--suite', 'unknown'], single('core')));
  for (const url of [
    target('core').replace('127.0.0.1', 'db.example.test'),
    target('core').replace('fixture:', 'root:'),
    target('core').replace('fixture:', ':'),
    target('core').replace('mysql:', 'https:'),
    target('core') + '?socketPath=unsafe',
    target('core').replace('nusrv_legacy_core_test', 'nusrv_rehearsal_test'),
  ]) assert.throws(() => planLegacyRuns(['--suite', 'core'], { DATABASE_URL: url, MARIADB_TEST_DATABASE_URL: url }));
  assert.throws(() => planLegacyRuns(['--suite', 'core'], { ...single('core'), DATABASE_URL: target('phase3c') }));
});

test('preflight failure, child timeout and test failure remain visible; later suites stay isolated', async () => {
  const plan = planLegacyRuns([], { MARIADB_TEST_SUITE_URLS: JSON.stringify(all()) }).slice(0, 4);
  const visited = [];
  const fakeSpawn = (executable, args, options) => {
    assert.equal(executable, 'node');
    assert.equal(options.timeout, CHILD_TIMEOUT_MS);
    assert.equal(options.killSignal, 'SIGKILL');
    visited.push(options.env.DATABASE_URL);
    if (visited.length === 1) return { error: { code: 'ETIMEDOUT' }, status: null };
    if (visited.length === 2) return { status: 1 };
    return { status: 0 };
  };
  const preflight = async (run) => { if (run.id === 'core') throw new Error('Not empty'); };
  assert.deepEqual(await runLegacyPlan(plan, fakeSpawn, preflight, 'node', () => {}), [
    { id: 'core', outcome: 'UNSAFE_OR_UNAVAILABLE' },
    { id: 'phase2', outcome: 'TIMEOUT' },
    { id: 'phase21', outcome: 'FAILED' },
    { id: 'subscription_backfill', outcome: 'PASSED' },
  ]);
  assert.equal(new Set(visited).size, 3);
  assert.ok(!visited.includes(target('core')));
});
