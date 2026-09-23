import { jest } from '@jest/globals';
import { AiSettingsResolverService, AI_SETTINGS_DEFAULT_CONFIDENCE_THRESHOLD } from './ai-settings-resolver.service';

function fakePrisma(row: Record<string, unknown> | null) {
  const findUnique = jest.fn(() => Promise.resolve(row));
  return { prisma: { aiSettings: { findUnique } }, findUnique };
}

describe('AiSettingsResolverService (Phase 3.1 §J)', () => {
  it('returns safe, fully-disabled defaults when no AiSettings row exists — never an error, never inferred enablement', async () => {
    const { prisma } = fakePrisma(null);
    const service = new AiSettingsResolverService(prisma as never, {} as never);

    const settings = await service.getSettings();

    expect(settings).toEqual({
      enabled: false,
      provider: 'OPENAI',
      model: null,
      confidenceThreshold: AI_SETTINGS_DEFAULT_CONFIDENCE_THRESHOLD,
      autoRouteAcceptEnabled: false,
      autoRouteAcceptCutoverAt: null,
    });
  });

  it('resolves fresh from the DB row every call — never cached across calls', async () => {
    const row: Record<string, unknown> = { enabled: false, provider: 'OPENAI', model: 'gpt-test', confidenceThreshold: '0.900', autoRouteAccept: false, autoRouteAcceptCutoverAt: null };
    const { prisma, findUnique } = fakePrisma(row);
    const service = new AiSettingsResolverService(prisma as never, {} as never);

    expect((await service.getSettings()).enabled).toBe(false);
    row.enabled = true; // simulates an admin flipping the Settings UI between two calls.
    expect((await service.getSettings()).enabled).toBe(true);
    expect(findUnique).toHaveBeenCalledTimes(2);
  });

  it('converts the stored Decimal confidenceThreshold to a plain number', async () => {
    const { prisma } = fakePrisma({ enabled: true, provider: 'OPENAI', model: 'gpt-test', confidenceThreshold: '0.850', autoRouteAccept: false, autoRouteAcceptCutoverAt: null });
    const service = new AiSettingsResolverService(prisma as never, {} as never);

    const settings = await service.getSettings();

    expect(settings.confidenceThreshold).toBe(0.85);
    expect(typeof settings.confidenceThreshold).toBe('number');
  });

  it('getApiKey() returns null when no row/key exists, without ever calling decrypt', async () => {
    const decrypt = jest.fn();
    const { prisma } = fakePrisma(null);
    const service = new AiSettingsResolverService(prisma as never, { decrypt } as never);

    expect(await service.getApiKey()).toBeNull();
    expect(decrypt).not.toHaveBeenCalled();
  });

  it('getApiKey() decrypts the stored ciphertext lazily and returns the plaintext key', async () => {
    const decrypt = jest.fn(() => ({ apiKey: 'sk-test-key' }));
    const findUnique = jest.fn(() => Promise.resolve({ apiKeyCiphertext: 'v1.iv.tag.ciphertext' }));
    const prisma = { aiSettings: { findUnique } };
    const service = new AiSettingsResolverService(prisma as never, { decrypt } as never);

    const key = await service.getApiKey();

    expect(key).toBe('sk-test-key');
    expect(decrypt).toHaveBeenCalledWith('v1.iv.tag.ciphertext');
  });
});
