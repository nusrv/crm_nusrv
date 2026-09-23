import 'dotenv/config';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import type { ConfigService } from '@nestjs/config';
import { toMariaDbDriverUrl } from '../src/database/mariadb-url';
import { PrismaClient } from '../src/generated/prisma/client';
import { SecretEncryptionService } from '../src/security/secret-encryption.service';
import { renderProvisioningSummary, runMailProvisioning } from './provision-mail-configuration';

/**
 * Operator-only CLI entrypoint. All values (including every secret) come from environment
 * variables — see PROJECT_STATUS.md / the Microsoft 365 setup checklist for the exact list. Never
 * accepts a secret as a CLI argument; `--dry-run` is the only flag this reads from argv.
 *
 * Usage: npm run provision:mail-config -- [--dry-run]
 */
const dryRun = process.argv.includes('--dry-run');

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required.');
  }

  // Minimal ConfigService shim — SecretEncryptionService only ever calls getOrThrow('ENCRYPTION_KEY_BASE64').
  // Reusing the real class (never re-implementing AES-256-GCM here) is the entire point of this
  // script: the exact same primitive SmtpMailTransport/ImapMailboxReader decrypt with at runtime.
  const configShim = {
    getOrThrow: (key: string): string => {
      const value = process.env[key];
      if (!value) throw new Error(`${key} is required.`);
      return value;
    },
  } as unknown as ConfigService;
  const encryption = new SecretEncryptionService(configShim);

  const prisma = new PrismaClient({ adapter: new PrismaMariaDb(toMariaDbDriverUrl(databaseUrl)) });
  try {
    const result = await runMailProvisioning(process.env, { encryption, prisma, dryRun });
    console.log(renderProvisioningSummary(result));
    if (!result.dryRun) {
      console.log('MailConfiguration provisioned successfully.');
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(`Mail configuration provisioning failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  process.exitCode = 1;
});
