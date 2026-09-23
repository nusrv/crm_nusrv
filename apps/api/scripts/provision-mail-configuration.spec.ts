import { jest } from '@jest/globals';
import { renderProvisioningSummary, runMailProvisioning } from './provision-mail-configuration';
import type { MailConfigurationUpsertClient, MailProvisioningEnv } from './provision-mail-configuration';

const OAUTH_ENV: MailProvisioningEnv = {
  MAIL_CONFIG_SCOPE: 'GLOBAL',
  MAIL_AUTH_MODE: 'MICROSOFT_OAUTH2',
  MAILBOX_ADDRESS: 'renewals@example.onmicrosoft.com',
  MAIL_IMAP_HOST: 'outlook.office365.com',
  MAIL_IMAP_PORT: '993',
  MAIL_IMAP_SECURE: 'true',
  MAIL_SMTP_HOST: 'smtp.office365.com',
  MAIL_SMTP_PORT: '587',
  MAIL_SMTP_SECURE: 'false',
  MS_TENANT_ID: 'tenant-1',
  MS_CLIENT_ID: 'client-1',
  MS_CLIENT_SECRET: 'super-secret-client-secret',
};

const BASIC_ENV: MailProvisioningEnv = {
  MAIL_CONFIG_SCOPE: 'BILLING_ENTITY:be-1',
  MAIL_AUTH_MODE: 'BASIC',
  MAILBOX_ADDRESS: 'billing@example.test',
  MAIL_IMAP_HOST: 'imap.example.test',
  MAIL_IMAP_PORT: '993',
  MAIL_IMAP_SECURE: 'true',
  MAIL_SMTP_HOST: 'smtp.example.test',
  MAIL_SMTP_PORT: '587',
  MAIL_SMTP_SECURE: 'true',
  MAIL_PASSWORD: 'super-secret-basic-password',
};

function fakeEncryption(ciphertext = 'v1.iv.tag.ciphertext') {
  return { encrypt: jest.fn(() => ciphertext) };
}

function fakePrisma() {
  const upsert = jest.fn(() => Promise.resolve(undefined));
  return { client: { mailConfiguration: { upsert } } as unknown as MailConfigurationUpsertClient, upsert };
}

describe('runMailProvisioning', () => {
  it('writes an encrypted MICROSOFT_OAUTH2 envelope into both credential fields', async () => {
    const encryption = fakeEncryption('encrypted-oauth-blob');
    const { client, upsert } = fakePrisma();

    const result = await runMailProvisioning(OAUTH_ENV, { encryption, prisma: client, dryRun: false });

    expect(encryption.encrypt).toHaveBeenCalledWith({
      authMode: 'MICROSOFT_OAUTH2',
      tenantId: 'tenant-1',
      clientId: 'client-1',
      clientSecret: 'super-secret-client-secret',
    });
    expect(upsert).toHaveBeenCalledTimes(1);
    const [args] = upsert.mock.calls[0]!;
    expect(args.where).toEqual({ scopeKey: 'GLOBAL' });
    expect(args.create).toMatchObject({
      scopeKey: 'GLOBAL',
      billingEntityId: null,
      smtpCredentialsCiphertext: 'encrypted-oauth-blob',
      imapCredentialsCiphertext: 'encrypted-oauth-blob',
      smtpUsername: 'renewals@example.onmicrosoft.com',
      imapUsername: 'renewals@example.onmicrosoft.com',
    });
    expect(args.update).toMatchObject({
      smtpCredentialsCiphertext: 'encrypted-oauth-blob',
      imapCredentialsCiphertext: 'encrypted-oauth-blob',
    });
    expect(result.dryRun).toBe(false);
    expect(result.sanitizedSummary.authMode).toBe('MICROSOFT_OAUTH2');
  });

  it('preserves BASIC compatibility, writing an explicit authMode: BASIC envelope', async () => {
    const encryption = fakeEncryption('encrypted-basic-blob');
    const { client, upsert } = fakePrisma();

    const result = await runMailProvisioning(BASIC_ENV, { encryption, prisma: client, dryRun: false });

    expect(encryption.encrypt).toHaveBeenCalledWith({ authMode: 'BASIC', password: 'super-secret-basic-password' });
    const [args] = upsert.mock.calls[0]!;
    expect(args.where).toEqual({ scopeKey: 'BILLING_ENTITY:be-1' });
    expect(args.create).toMatchObject({ scopeKey: 'BILLING_ENTITY:be-1', billingEntityId: 'be-1' });
    expect(result.sanitizedSummary.authMode).toBe('BASIC');
  });

  it.each([
    'MAIL_CONFIG_SCOPE',
    'MAIL_AUTH_MODE',
    'MAILBOX_ADDRESS',
    'MAIL_IMAP_HOST',
    'MAIL_IMAP_PORT',
    'MAIL_IMAP_SECURE',
    'MAIL_SMTP_HOST',
    'MAIL_SMTP_PORT',
    'MAIL_SMTP_SECURE',
  ])('fails closed (throws, zero DB writes) when %s is missing', async (missingKey) => {
    const env = { ...OAUTH_ENV, [missingKey]: undefined };
    const encryption = fakeEncryption();
    const { client, upsert } = fakePrisma();

    await expect(runMailProvisioning(env, { encryption, prisma: client, dryRun: false })).rejects.toThrow();
    expect(upsert).not.toHaveBeenCalled();
    expect(encryption.encrypt).not.toHaveBeenCalled();
  });

  it('fails closed when MICROSOFT_OAUTH2-specific env vars are missing', async () => {
    const env = { ...OAUTH_ENV, MS_CLIENT_SECRET: undefined };
    const encryption = fakeEncryption();
    const { client, upsert } = fakePrisma();

    await expect(runMailProvisioning(env, { encryption, prisma: client, dryRun: false })).rejects.toThrow('MS_CLIENT_SECRET');
    expect(upsert).not.toHaveBeenCalled();
  });

  it('fails closed when the BASIC-specific env var is missing', async () => {
    const env = { ...BASIC_ENV, MAIL_PASSWORD: undefined };
    const encryption = fakeEncryption();
    const { client, upsert } = fakePrisma();

    await expect(runMailProvisioning(env, { encryption, prisma: client, dryRun: false })).rejects.toThrow('MAIL_PASSWORD');
    expect(upsert).not.toHaveBeenCalled();
  });

  it('rejects an invalid MAIL_CONFIG_SCOPE, writing nothing', async () => {
    const env = { ...OAUTH_ENV, MAIL_CONFIG_SCOPE: 'NOT_A_VALID_SCOPE' };
    const encryption = fakeEncryption();
    const { client, upsert } = fakePrisma();

    await expect(runMailProvisioning(env, { encryption, prisma: client, dryRun: false })).rejects.toThrow('MAIL_CONFIG_SCOPE');
    expect(upsert).not.toHaveBeenCalled();
  });

  it('rejects an invalid MAIL_AUTH_MODE, writing nothing', async () => {
    const env = { ...OAUTH_ENV, MAIL_AUTH_MODE: 'SOMETHING_ELSE' };
    const encryption = fakeEncryption();
    const { client, upsert } = fakePrisma();

    await expect(runMailProvisioning(env, { encryption, prisma: client, dryRun: false })).rejects.toThrow('MAIL_AUTH_MODE');
    expect(upsert).not.toHaveBeenCalled();
  });

  it('dry run performs zero DB writes and never encrypts anything, while still validating fully', async () => {
    const encryption = fakeEncryption();
    const { client, upsert } = fakePrisma();

    const result = await runMailProvisioning(OAUTH_ENV, { encryption, prisma: client, dryRun: true });

    expect(result.dryRun).toBe(true);
    expect(upsert).not.toHaveBeenCalled();
    expect(encryption.encrypt).not.toHaveBeenCalled();
    expect(result.sanitizedSummary).toEqual({
      scopeKey: 'GLOBAL',
      billingEntityId: null,
      mailbox: 'renewals@example.onmicrosoft.com',
      authMode: 'MICROSOFT_OAUTH2',
      imap: { host: 'outlook.office365.com', port: 993, secure: true },
      smtp: { host: 'smtp.office365.com', port: 587, secure: false },
    });
  });

  it('dry run still fails closed on a missing required field, before touching anything', async () => {
    const env = { ...OAUTH_ENV, MAIL_SMTP_HOST: undefined };
    const encryption = fakeEncryption();
    const { client, upsert } = fakePrisma();

    await expect(runMailProvisioning(env, { encryption, prisma: client, dryRun: true })).rejects.toThrow('MAIL_SMTP_HOST');
    expect(upsert).not.toHaveBeenCalled();
  });

  it('never includes any secret in the returned summary or its rendered text', async () => {
    const encryption = fakeEncryption('encrypted-oauth-blob');
    const { client } = fakePrisma();

    const result = await runMailProvisioning(OAUTH_ENV, { encryption, prisma: client, dryRun: false });
    const rendered = renderProvisioningSummary(result);

    expect(Object.keys(result.sanitizedSummary)).not.toContain('clientSecret');
    expect(Object.keys(result.sanitizedSummary)).not.toContain('password');
    expect(rendered).not.toContain('super-secret-client-secret');
    expect(rendered).not.toContain('encrypted-oauth-blob');
  });

  it('never prints a secret in the dry-run rendered text either', async () => {
    const encryption = fakeEncryption();
    const { client } = fakePrisma();

    const result = await runMailProvisioning(BASIC_ENV, { encryption, prisma: client, dryRun: true });
    const rendered = renderProvisioningSummary(result);

    expect(rendered).not.toContain('super-secret-basic-password');
  });
});
