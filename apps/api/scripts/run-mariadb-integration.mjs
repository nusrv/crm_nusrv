import { spawnSync } from 'node:child_process';

if (!process.env.MARIADB_TEST_DATABASE_URL) {
  throw new Error(
    'MARIADB_TEST_DATABASE_URL is required and must target a disposable database ending in _test.',
  );
}

const result = spawnSync(
  process.execPath,
  [
    '--experimental-vm-modules',
    '../../node_modules/jest/bin/jest.js',
    'prisma/mariadb-live.spec.ts',
    'prisma/mariadb-phase2-live.spec.ts',
    '--runInBand',
  ],
  { stdio: 'inherit', env: process.env },
);

process.exit(result.status ?? 1);
