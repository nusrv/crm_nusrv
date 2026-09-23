import type { BasicSmtpCredentials, SmtpCredentials } from '../src/modules/mail/smtp-credentials';
import type { MicrosoftOAuth2Credentials } from '../src/modules/mail/microsoft-oauth-credentials';

export type MailProvisioningEnv = NodeJS.ProcessEnv;

/** The exact envelope shape SmtpMailTransport/ImapMailboxReader already decrypt at runtime (see
 * smtp-credentials.ts/imap-credentials.ts) — reused here, never redefined, so this script can never
 * drift from what the real mail pipeline actually expects. */
export type MailProvisioningCredentials = SmtpCredentials;

export interface EncryptionLike {
  encrypt(value: unknown): string;
}

export interface MailConfigurationUpsertClient {
  mailConfiguration: {
    upsert(args: {
      where: { scopeKey: string };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }): Promise<unknown>;
  };
}

export interface MailProvisioningDeps {
  encryption: EncryptionLike;
  prisma: MailConfigurationUpsertClient;
  dryRun: boolean;
}

export interface MailProvisioningSummary {
  scopeKey: string;
  billingEntityId: string | null;
  mailbox: string;
  authMode: 'BASIC' | 'MICROSOFT_OAUTH2';
  imap: { host: string; port: number; secure: boolean };
  smtp: { host: string; port: number; secure: boolean };
}

export interface MailProvisioningResult {
  dryRun: boolean;
  sanitizedSummary: MailProvisioningSummary;
}

function requireEnv(env: MailProvisioningEnv, key: string): string {
  const value = env[key];
  if (!value || !value.trim()) {
    throw new Error(`${key} is required.`);
  }
  return value;
}

function parseScope(raw: string | undefined): { scopeKey: string; billingEntityId: string | null } {
  if (!raw || !raw.trim()) {
    throw new Error('MAIL_CONFIG_SCOPE is required (exactly "GLOBAL" or "BILLING_ENTITY:<id>").');
  }
  if (raw === 'GLOBAL') return { scopeKey: 'GLOBAL', billingEntityId: null };
  const match = /^BILLING_ENTITY:([A-Za-z0-9-]+)$/.exec(raw);
  if (!match) {
    throw new Error('MAIL_CONFIG_SCOPE must be exactly "GLOBAL" or "BILLING_ENTITY:<id>".');
  }
  return { scopeKey: raw, billingEntityId: match[1]! };
}

function parseAuthMode(raw: string | undefined): 'BASIC' | 'MICROSOFT_OAUTH2' {
  if (raw === 'BASIC' || raw === 'MICROSOFT_OAUTH2') return raw;
  throw new Error('MAIL_AUTH_MODE must be exactly "BASIC" or "MICROSOFT_OAUTH2".');
}

function parsePort(raw: string | undefined, field: string): number {
  const port = Number(raw);
  if (!raw || !Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`${field} must be a valid TCP port number (1-65535).`);
  }
  return port;
}

function parseBoolean(raw: string | undefined, field: string): boolean {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new Error(`${field} must be exactly "true" or "false".`);
}

function buildCredentials(env: MailProvisioningEnv, authMode: 'BASIC' | 'MICROSOFT_OAUTH2'): MailProvisioningCredentials {
  if (authMode === 'MICROSOFT_OAUTH2') {
    const oauth: MicrosoftOAuth2Credentials = {
      authMode: 'MICROSOFT_OAUTH2',
      tenantId: requireEnv(env, 'MS_TENANT_ID'),
      clientId: requireEnv(env, 'MS_CLIENT_ID'),
      clientSecret: requireEnv(env, 'MS_CLIENT_SECRET'),
    };
    return oauth;
  }
  const basic: BasicSmtpCredentials = { authMode: 'BASIC', password: requireEnv(env, 'MAIL_PASSWORD') };
  return basic;
}

/**
 * Operator-only, one-time-per-mailbox provisioning: creates or updates exactly one
 * MailConfiguration row from environment variables, using the SAME SecretEncryptionService/
 * MailConfiguration conventions SmtpMailTransport/ImapMailboxReader already read at runtime — this
 * never reimplements encryption and never adds a new credential field/migration.
 *
 * Every required value is validated BEFORE the encryption key or the database is ever touched
 * (fail closed: a misconfigured invocation writes nothing, not a partial/garbage row). In dry-run
 * mode, validation still runs in full (so a dry run genuinely proves the invocation would succeed),
 * but `deps.encryption.encrypt()` and `deps.prisma.mailConfiguration.upsert()` are never called —
 * zero DB writes, and the plaintext credential is never even turned into ciphertext.
 *
 * `sanitizedSummary` is the ONLY thing this function returns for display — it structurally cannot
 * contain a secret, ciphertext, or access token, because those values are never assigned to it.
 */
export async function runMailProvisioning(env: MailProvisioningEnv, deps: MailProvisioningDeps): Promise<MailProvisioningResult> {
  const { scopeKey, billingEntityId } = parseScope(env.MAIL_CONFIG_SCOPE);
  const authMode = parseAuthMode(env.MAIL_AUTH_MODE);
  const mailbox = requireEnv(env, 'MAILBOX_ADDRESS');
  const imapHost = requireEnv(env, 'MAIL_IMAP_HOST');
  const imapPort = parsePort(env.MAIL_IMAP_PORT, 'MAIL_IMAP_PORT');
  const imapSecure = parseBoolean(env.MAIL_IMAP_SECURE, 'MAIL_IMAP_SECURE');
  const smtpHost = requireEnv(env, 'MAIL_SMTP_HOST');
  const smtpPort = parsePort(env.MAIL_SMTP_PORT, 'MAIL_SMTP_PORT');
  const smtpSecure = parseBoolean(env.MAIL_SMTP_SECURE, 'MAIL_SMTP_SECURE');
  // Validated here (fail-closed applies to secrets too), but deliberately never read into a local
  // used anywhere except buildCredentials()/encrypt() below — never logged, never part of the
  // summary, and (in dry-run) never even encrypted.
  const credentials = buildCredentials(env, authMode);

  const label = env.MAIL_LABEL?.trim() || `Mail (${scopeKey})`;
  const fromAddress = env.MAIL_FROM_ADDRESS?.trim() || mailbox;
  const fromName = env.MAIL_FROM_NAME?.trim() || 'CRM Notifications';

  const sanitizedSummary: MailProvisioningSummary = {
    scopeKey,
    billingEntityId,
    mailbox,
    authMode,
    imap: { host: imapHost, port: imapPort, secure: imapSecure },
    smtp: { host: smtpHost, port: smtpPort, secure: smtpSecure },
  };

  if (deps.dryRun) {
    return { dryRun: true, sanitizedSummary };
  }

  const credentialsCiphertext = deps.encryption.encrypt(credentials);
  const sharedFields = {
    label,
    smtpHost,
    smtpPort,
    smtpSecure,
    smtpUsername: mailbox,
    smtpCredentialsCiphertext: credentialsCiphertext,
    imapHost,
    imapPort,
    imapSecure,
    imapUsername: mailbox,
    imapCredentialsCiphertext: credentialsCiphertext,
    fromAddress,
    fromName,
  };

  await deps.prisma.mailConfiguration.upsert({
    where: { scopeKey },
    create: { scopeKey, billingEntityId, ...sharedFields },
    update: sharedFields,
  });

  return { dryRun: false, sanitizedSummary };
}

/** The exact, sole text a caller should print — every key is drawn only from `sanitizedSummary`,
 * which structurally excludes every secret/ciphertext/token (see runMailProvisioning's doc comment). */
export function renderProvisioningSummary(result: MailProvisioningResult): string {
  return JSON.stringify({ dryRun: result.dryRun, ...result.sanitizedSummary }, null, 2);
}
