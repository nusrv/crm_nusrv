import { jest } from '@jest/globals';
import { IntegrationHealthService } from './integration-health.service';

function baseConfigRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mc-1',
    scopeKey: 'GLOBAL',
    label: 'Global',
    enabled: true,
    outboundSendEnabled: true,
    inboundSyncEnabled: true,
    imapHost: 'imap.example.test',
    imapUsername: 'operator@example.test',
    imapFolder: 'INBOX',
    imapCredentialsCiphertext: 'v1.imap-ciphertext',
    lastSyncedAt: null,
    smtpCredentialsCiphertext: 'v1.ciphertext',
    lastHealthStatus: 'HEALTHY',
    lastHealthCheckedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function harness(
  options: {
    configRow?: Record<string, unknown>;
    configValues?: Record<string, string>;
    aiSettings?: { provider: string; model: string | null };
  } = {},
) {
  const row = options.configRow ?? baseConfigRow();
  const prisma = {
    mailConfiguration: { findMany: jest.fn(() => Promise.resolve([row])) },
    integrationHealthEvent: { findFirst: jest.fn(() => Promise.resolve(null)) },
  };
  const config = { get: (key: string) => (options.configValues ?? {})[key] };
  const aiSettings = {
    getSettings: () =>
      Promise.resolve({
        enabled: false,
        provider: options.aiSettings?.provider ?? 'OPENAI',
        model: options.aiSettings?.model ?? null,
        confidenceThreshold: 0.9,
        autoRouteAcceptEnabled: false,
        autoRouteAcceptCutoverAt: null,
      }),
  };
  const service = new IntegrationHealthService(prisma as never, config as never, aiSettings as never);
  return { service, prisma };
}

describe('IntegrationHealthService.getOverview — Phase 3.1 §3 effective status', () => {
  it('READY only when configured, operationally enabled, AND the deployment adapter is REAL', async () => {
    const { service } = harness({ configValues: { SMTP_MODE: 'real', IMAP_MODE: 'real' } });
    const overview = await service.getOverview();
    expect(overview.mail[0]!.smtpStatus).toEqual({
      configured: true,
      operationallyEnabled: true,
      deploymentAdapter: 'REAL',
      effective: 'READY',
    });
    expect(overview.mail[0]!.imapStatus.effective).toBe('READY');
  });

  it('regression §6.6/§6.7 — never reports READY when the deployment adapter is MOCK, even though DB config says fully enabled (no misleading readiness)', async () => {
    const { service } = harness({ configValues: { SMTP_MODE: 'mock', IMAP_MODE: 'mock' } });
    const overview = await service.getOverview();
    expect(overview.mail[0]!.smtpStatus.effective).toBe('BLOCKED_BY_DEPLOYMENT');
    expect(overview.mail[0]!.imapStatus.effective).toBe('BLOCKED_BY_DEPLOYMENT');
  });

  it('regression — MAIL_SEND_ENABLED/IMAP_SYNC_ENABLED env values have no effect on effective status, only the DB operational switches do', async () => {
    const { service } = harness({
      configValues: { SMTP_MODE: 'real', IMAP_MODE: 'real', MAIL_SEND_ENABLED: 'false', IMAP_SYNC_ENABLED: 'false' },
    });
    const overview = await service.getOverview();
    expect(overview.mail[0]!.smtpStatus.effective).toBe('READY');
    expect(overview.mail[0]!.imapStatus.effective).toBe('READY');
  });

  it('DISABLED when the DB operational switch is off, regardless of a REAL deployment adapter', async () => {
    const { service } = harness({
      configRow: baseConfigRow({ outboundSendEnabled: false, inboundSyncEnabled: false }),
      configValues: { SMTP_MODE: 'real', IMAP_MODE: 'real' },
    });
    const overview = await service.getOverview();
    expect(overview.mail[0]!.smtpStatus.effective).toBe('DISABLED');
    expect(overview.mail[0]!.imapStatus.effective).toBe('DISABLED');
  });

  it('NOT_CONFIGURED when no credentials are stored, taking priority over every other layer', async () => {
    const { service } = harness({
      configRow: baseConfigRow({ smtpCredentialsCiphertext: null }),
      configValues: { SMTP_MODE: 'mock' },
    });
    const overview = await service.getOverview();
    expect(overview.mail[0]!.smtpStatus.effective).toBe('NOT_CONFIGURED');
  });
});

describe('IntegrationHealthService.getOverview — §L effective AI provider/model display', () => {
  it('reports the actual selected provider/model, never a hardcoded "OpenAI", even when a health check has never run', async () => {
    const { service } = harness({ aiSettings: { provider: 'ANTHROPIC', model: 'claude-test-model' } });
    const overview = await service.getOverview();
    expect(overview.ai).toEqual({ provider: 'ANTHROPIC', model: 'claude-test-model', health: null });
  });

  it('defaults to OPENAI/null only because that mirrors AiSettingsResolverService\'s own safe default when no row exists', async () => {
    const { service } = harness();
    const overview = await service.getOverview();
    expect(overview.ai.provider).toBe('OPENAI');
    expect(overview.ai.model).toBeNull();
  });
});


describe('P2.A read-only evidence-source inventory', () => {
  it('reports only configured current inbound source without asserting message delivery', async () => {
    const { service, prisma } = harness({ configValues: { IMAP_MODE: 'real' } });
    const rows = await service.getEvidenceSources();
    expect(rows).toEqual([{
      mailConfigurationId: 'mc-1',
      scope: 'GLOBAL',
      label: 'Global',
      configuredInboundFolder: 'INBOX',
      lastInboundSyncAt: null,
      inboundFolder: 'CONFIGURED_ONLY',
      sentFolder: 'BLOCKED_BY_DEPLOYMENT',
      providerEvents: 'NOT_IMPLEMENTED',
      dsnCorrelation: 'NOT_IMPLEMENTED',
    }]);
    expect(prisma.mailConfiguration.findMany).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(rows)).not.toContain('v1.imap-ciphertext');
  });

  it('distinguishes disabled mailbox from missing credentials and mock adapter', async () => {
    const disabled = harness({
      configRow: baseConfigRow({ inboundSyncEnabled: false }),
      configValues: { IMAP_MODE: 'real' },
    });
    expect((await disabled.service.getEvidenceSources())[0]?.inboundFolder).toBe('DISABLED');

    const missing = harness({
      configRow: baseConfigRow({ imapCredentialsCiphertext: null }),
      configValues: { IMAP_MODE: 'real' },
    });
    expect((await missing.service.getEvidenceSources())[0]?.inboundFolder).toBe('NOT_CONFIGURED');

    const blocked = harness({ configValues: { IMAP_MODE: 'mock' } });
    expect((await blocked.service.getEvidenceSources())[0]?.inboundFolder).toBe('BLOCKED_BY_DEPLOYMENT');
  });

  it('does not infer Sent or DSN capability from an earlier successful inbound sync timestamp', async () => {
    const { service } = harness({
      configRow: baseConfigRow({ lastSyncedAt: new Date('2026-11-23T12:00:00.000Z') }),
      configValues: { IMAP_MODE: 'real' },
    });
    const row = (await service.getEvidenceSources())[0];
    expect(row?.lastInboundSyncAt).toEqual(new Date('2026-11-23T12:00:00.000Z'));
    expect(row?.sentFolder).toBe('BLOCKED_BY_DEPLOYMENT');
    expect(row?.dsnCorrelation).toBe('NOT_IMPLEMENTED');
  });
});
