// Destructive legacy fixtures must never share a schema across suites.
export const LEGACY_SUITES = Object.freeze({
  core: 'prisma/mariadb-live.spec.ts',
  phase2: 'prisma/mariadb-phase2-live.spec.ts',
  phase21: 'prisma/mariadb-phase21-live.spec.ts',
  subscription_backfill: 'prisma/mariadb-subscription-code-backfill-live.spec.ts',
  subscription_sequence_delete: 'prisma/mariadb-subscription-code-sequence-delete-live.spec.ts',
  phase3a: 'prisma/mariadb-phase3-slice-a-live.spec.ts',
  phase3b: 'prisma/mariadb-phase3-slice-b-live.spec.ts',
  phase3c: 'prisma/mariadb-phase3-slice-c-live.spec.ts',
  phase3d: 'prisma/mariadb-phase3-slice-d-live.spec.ts',
  phase3e: 'prisma/mariadb-phase3-slice-e-live.spec.ts',
});
export const SUITE_IDS = Object.freeze(Object.keys(LEGACY_SUITES));
export const CHILD_TIMEOUT_MS = 480_000;

function validateTarget(id, value) {
  let url;
  try {
    if (typeof value !== 'string') throw new Error();
    url = new URL(value);
    if (url.protocol !== 'mysql:' || url.hostname !== '127.0.0.1' ||
        url.pathname !== '/nusrv_legacy_' + id + '_test' ||
        !url.username || !url.password ||
        /^(root|admin)$/i.test(decodeURIComponent(url.username)) ||
        url.search || url.hash) throw new Error();
  } catch {
    throw new Error('Refusing missing or unsafe MariaDB target for suite ' + id);
  }
  return url.href;
}

export function planLegacyRuns(args, env) {
  let targets;
  let ids;
  if (args.length === 2 && args[0] === '--suite' && SUITE_IDS.includes(args[1])) {
    ids = [args[1]];
    const a = validateTarget(ids[0], env.MARIADB_TEST_DATABASE_URL);
    const b = validateTarget(ids[0], env.DATABASE_URL);
    if (a !== b) throw new Error('Both DB URL variables must match for a single suite.');
    targets = { [ids[0]]: a };
  } else if (args.length === 0) {
    ids = SUITE_IDS;
    try { targets = JSON.parse(env.MARIADB_TEST_SUITE_URLS ?? 'null'); }
    catch { throw new Error('Invalid MARIADB_TEST_SUITE_URLS JSON.'); }
    if (!targets || typeof targets !== 'object' || Array.isArray(targets) ||
        Object.keys(targets).length !== ids.length ||
        Object.keys(targets).some((id) => !ids.includes(id))) {
      throw new Error('All-suite mode requires an explicit dedicated URL for each suite.');
    }
  } else {
    throw new Error('Use --suite <known ID>, or provide all ten isolated targets.');
  }
  return ids.map((id) => {
    const target = validateTarget(id, targets[id]);
    const childEnv = { ...env };
    delete childEnv.MARIADB_TEST_SUITE_URLS;
    return {
      id,
      args: ['--experimental-vm-modules', '../../node_modules/jest/bin/jest.js',
        '--runInBand', '--runTestsByPath', LEGACY_SUITES[id]],
      env: {
        ...childEnv,
        DATABASE_URL: target,
        MARIADB_TEST_DATABASE_URL: target,
        SMTP_MODE: 'none',
        IMAP_MODE: 'none',
        AI_PROVIDER: 'mock',
      },
    };
  });
}

// Every child owns a different schema. A timed-out schema must not be reused.
// The launcher never creates or drops databases and never force-exits Jest.
export async function runLegacyPlan(plan, spawn, preflight, executable, log = console.log) {
  const results = [];
  for (const run of plan) {
    log('[legacy-db] Starting ' + run.id);
    try {
      await preflight(run);
    } catch {
      results.push({ id: run.id, outcome: 'UNSAFE_OR_UNAVAILABLE' });
      log('[legacy-db] ' + run.id + ': UNSAFE_OR_UNAVAILABLE');
      continue;
    }
    const result = spawn(executable, run.args, {
      stdio: 'inherit', env: run.env,
      timeout: CHILD_TIMEOUT_MS, killSignal: 'SIGKILL',
    });
    const outcome = result.error?.code === 'ETIMEDOUT' ? 'TIMEOUT' :
      result.error || result.signal || result.status !== 0 ? 'FAILED' : 'PASSED';
    results.push({ id: run.id, outcome });
    log('[legacy-db] ' + run.id + ': ' + outcome);
  }
  return results;
}
