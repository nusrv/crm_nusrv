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

test('full legacy run preserves all twelve suites with distinct targets', () => {
  const plan = planLegacyRuns([], { MARIADB_TEST_SUITE_URLS: JSON.stringify(all()) });
  assert.equal(plan.length, 12);
  assert.equal(new Set(plan.map((run) => run.env.DATABASE_URL)).size, 12);
  assert.equal(new Set(plan.map((run) => run.args.at(-1))).size, 12);
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

test('financial suites use their exact opt-in variables and strip unrelated inherited targets', () => {
  const inherited = {
    MARIADB_PHASE4_TEST_DATABASE_URL: 'mysql://unsafe:unsafe@remote.invalid/production',
    MARIADB_BRANDING_TEST_DATABASE_URL: 'mysql://unsafe:unsafe@remote.invalid/production',
  };
  const plan = planLegacyRuns([], { ...inherited, MARIADB_TEST_SUITE_URLS: JSON.stringify(all()) });
  for (const run of plan) {
    const expected = run.id === 'phase4' ? 'MARIADB_PHASE4_TEST_DATABASE_URL' :
      run.id === 'branding' ? 'MARIADB_BRANDING_TEST_DATABASE_URL' : null;
    for (const key of Object.keys(inherited)) {
      assert.equal(run.env[key], key === expected ? target(run.id) : undefined);
    }
    assert.equal(run.env.DATABASE_URL, target(run.id));
    assert.equal(run.env.MARIADB_TEST_DATABASE_URL, target(run.id));
  }
  for (const id of ['phase4', 'branding']) {
    const [run] = planLegacyRuns(['--suite', id], { ...single(id), ...inherited });
    assert.equal(run.args.at(-1), 'prisma/mariadb-' + id + '-live.spec.ts');
    assert.equal(run.env[id === 'phase4' ? 'MARIADB_PHASE4_TEST_DATABASE_URL' : 'MARIADB_BRANDING_TEST_DATABASE_URL'], target(id));
  }
  const incomplete = all(); delete incomplete.branding;
  assert.throws(() => planLegacyRuns([], { MARIADB_TEST_SUITE_URLS: JSON.stringify(incomplete) }));
});
