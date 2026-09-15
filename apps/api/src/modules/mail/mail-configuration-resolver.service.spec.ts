import { jest } from '@jest/globals';
import { MailConfigurationResolverService } from './mail-configuration-resolver.service';

function makeConfig(overrides: Record<string, unknown> = {}) {
  return {
    id: 'config-id',
    billingEntityId: null,
    environment: 'SANDBOX',
    enabled: true,
    ...overrides,
  };
}

describe('MailConfigurationResolverService', () => {
  it('uses an enabled BillingEntity override without ever querying GLOBAL', async () => {
    const override = makeConfig({ billingEntityId: 'be-1', enabled: true });
    const findFirst = jest.fn(() => Promise.resolve(override));
    const prisma = { mailConfiguration: { findFirst } };
    const config = { get: () => 'test' };
    const service = new MailConfigurationResolverService(prisma as never, config as never);

    const result = await service.resolveForOutbound('be-1');

    expect(result).toEqual({ usable: true, config: override });
    expect(findFirst).toHaveBeenCalledTimes(1);
  });

  it('never falls back to GLOBAL when the override exists but is disabled', async () => {
    const override = makeConfig({ billingEntityId: 'be-1', enabled: false });
    const findFirst = jest.fn(() => Promise.resolve(override));
    const prisma = { mailConfiguration: { findFirst } };
    const config = { get: () => 'test' };
    const service = new MailConfigurationResolverService(prisma as never, config as never);

    const result = await service.resolveForOutbound('be-1');

    expect(result).toEqual({ usable: false, reason: 'BILLING_ENTITY_OVERRIDE_DISABLED' });
    expect(findFirst).toHaveBeenCalledTimes(1);
  });

  it('falls back to an enabled GLOBAL configuration when no override exists', async () => {
    const global = makeConfig({ billingEntityId: null, enabled: true });
    const findFirst = jest.fn((args: { where: { billingEntityId: unknown } }) =>
      Promise.resolve(args.where.billingEntityId === null ? global : null),
    );
    const prisma = { mailConfiguration: { findFirst } };
    const config = { get: () => 'test' };
    const service = new MailConfigurationResolverService(prisma as never, config as never);

    const result = await service.resolveForOutbound('be-1');

    expect(result).toEqual({ usable: true, config: global });
    expect(findFirst).toHaveBeenCalledTimes(2);
  });

  it('reports GLOBAL_DISABLED when no override exists and GLOBAL is disabled', async () => {
    const global = makeConfig({ billingEntityId: null, enabled: false });
    const findFirst = jest.fn((args: { where: { billingEntityId: unknown } }) =>
      Promise.resolve(args.where.billingEntityId === null ? global : null),
    );
    const prisma = { mailConfiguration: { findFirst } };
    const config = { get: () => 'test' };
    const service = new MailConfigurationResolverService(prisma as never, config as never);

    const result = await service.resolveForOutbound('be-1');

    expect(result).toEqual({ usable: false, reason: 'GLOBAL_DISABLED' });
  });

  it('reports NO_CONFIGURATION when neither an override nor GLOBAL exists', async () => {
    const findFirst = jest.fn(() => Promise.resolve(null));
    const prisma = { mailConfiguration: { findFirst } };
    const config = { get: () => 'test' };
    const service = new MailConfigurationResolverService(prisma as never, config as never);

    const result = await service.resolveForOutbound('be-1');

    expect(result).toEqual({ usable: false, reason: 'NO_CONFIGURATION' });
  });

  it('fails closed on an environment mismatch (PRODUCTION config, non-production process)', async () => {
    const override = makeConfig({ billingEntityId: 'be-1', enabled: true, environment: 'PRODUCTION' });
    const findFirst = jest.fn(() => Promise.resolve(override));
    const prisma = { mailConfiguration: { findFirst } };
    const config = { get: () => 'development' };
    const service = new MailConfigurationResolverService(prisma as never, config as never);

    const result = await service.resolveForOutbound('be-1');

    expect(result).toEqual({ usable: false, reason: 'ENVIRONMENT_MISMATCH' });
  });

  describe('resolvePinned', () => {
    it('reports PINNED_CONFIGURATION_MISSING when the pinned config no longer exists', () => {
      const service = new MailConfigurationResolverService({} as never, { get: () => 'test' } as never);
      expect(service.resolvePinned(null)).toEqual({ usable: false, reason: 'PINNED_CONFIGURATION_MISSING' });
    });

    it('reports PINNED_CONFIGURATION_DISABLED when it has since been disabled', () => {
      const service = new MailConfigurationResolverService({} as never, { get: () => 'test' } as never);
      const config = makeConfig({ enabled: false });
      expect(service.resolvePinned(config as never)).toEqual({
        usable: false,
        reason: 'PINNED_CONFIGURATION_DISABLED',
      });
    });

    it('still applies the environment guard to a pinned configuration', () => {
      const service = new MailConfigurationResolverService({} as never, { get: () => 'production' } as never);
      const config = makeConfig({ enabled: true, environment: 'SANDBOX' });
      expect(service.resolvePinned(config as never)).toEqual({ usable: false, reason: 'ENVIRONMENT_MISMATCH' });
    });

    it('is usable when the pinned configuration is still enabled and environment-valid', () => {
      const service = new MailConfigurationResolverService({} as never, { get: () => 'test' } as never);
      const config = makeConfig({ enabled: true, environment: 'SANDBOX' });
      expect(service.resolvePinned(config as never)).toEqual({ usable: true, config });
    });
  });
});
