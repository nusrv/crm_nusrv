import { jest } from '@jest/globals';
import { MailConfigurationResolverService } from './mail-configuration-resolver.service';

const NOW = new Date('2026-02-01T00:00:00.000Z');
const PAST_CUTOVER = new Date('2026-01-01T00:00:00.000Z');
const FUTURE_CUTOVER = new Date('2026-03-01T00:00:00.000Z');

function fakeClock(now: Date = NOW) {
  return { now: () => now };
}

/** Phase 3.1 §D — every "usable" scenario below is about resolution ALGORITHM (BillingEntity
 * override vs. GLOBAL fallback, environment guard), so the baseline fixture defaults
 * outboundSendEnabled/outboundSendCutoverAt to an already-turned-on state; the new outbound-
 * enablement/cutover gate itself is exercised by its own dedicated describe block below. */
function makeConfig(overrides: Record<string, unknown> = {}) {
  return {
    id: 'config-id',
    billingEntityId: null,
    environment: 'SANDBOX',
    enabled: true,
    outboundSendEnabled: true,
    outboundSendCutoverAt: PAST_CUTOVER,
    ...overrides,
  };
}

describe('MailConfigurationResolverService', () => {
  it('uses an enabled BillingEntity override without ever querying GLOBAL', async () => {
    const override = makeConfig({ billingEntityId: 'be-1', enabled: true });
    const findFirst = jest.fn(() => Promise.resolve(override));
    const prisma = { mailConfiguration: { findFirst } };
    const config = { get: () => 'test' };
    const service = new MailConfigurationResolverService(prisma as never, config as never, fakeClock());

    const result = await service.resolveForOutbound('be-1');

    expect(result).toEqual({ usable: true, config: override });
    expect(findFirst).toHaveBeenCalledTimes(1);
  });

  it('never falls back to GLOBAL when the override exists but is disabled', async () => {
    const override = makeConfig({ billingEntityId: 'be-1', enabled: false });
    const findFirst = jest.fn(() => Promise.resolve(override));
    const prisma = { mailConfiguration: { findFirst } };
    const config = { get: () => 'test' };
    const service = new MailConfigurationResolverService(prisma as never, config as never, fakeClock());

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
    const service = new MailConfigurationResolverService(prisma as never, config as never, fakeClock());

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
    const service = new MailConfigurationResolverService(prisma as never, config as never, fakeClock());

    const result = await service.resolveForOutbound('be-1');

    expect(result).toEqual({ usable: false, reason: 'GLOBAL_DISABLED' });
  });

  it('reports NO_CONFIGURATION when neither an override nor GLOBAL exists', async () => {
    const findFirst = jest.fn(() => Promise.resolve(null));
    const prisma = { mailConfiguration: { findFirst } };
    const config = { get: () => 'test' };
    const service = new MailConfigurationResolverService(prisma as never, config as never, fakeClock());

    const result = await service.resolveForOutbound('be-1');

    expect(result).toEqual({ usable: false, reason: 'NO_CONFIGURATION' });
  });

  it('fails closed on an environment mismatch (PRODUCTION config, non-production process)', async () => {
    const override = makeConfig({ billingEntityId: 'be-1', enabled: true, environment: 'PRODUCTION' });
    const findFirst = jest.fn(() => Promise.resolve(override));
    const prisma = { mailConfiguration: { findFirst } };
    const config = { get: () => 'development' };
    const service = new MailConfigurationResolverService(prisma as never, config as never, fakeClock());

    const result = await service.resolveForOutbound('be-1');

    expect(result).toEqual({ usable: false, reason: 'ENVIRONMENT_MISMATCH' });
  });

  describe('resolvePinned', () => {
    it('reports PINNED_CONFIGURATION_MISSING when the pinned config no longer exists', () => {
      const service = new MailConfigurationResolverService({} as never, { get: () => 'test' } as never, fakeClock());
      expect(service.resolvePinned(null)).toEqual({ usable: false, reason: 'PINNED_CONFIGURATION_MISSING' });
    });

    it('reports PINNED_CONFIGURATION_DISABLED when it has since been disabled', () => {
      const service = new MailConfigurationResolverService({} as never, { get: () => 'test' } as never, fakeClock());
      const config = makeConfig({ enabled: false });
      expect(service.resolvePinned(config as never)).toEqual({
        usable: false,
        reason: 'PINNED_CONFIGURATION_DISABLED',
      });
    });

    it('still applies the environment guard to a pinned configuration', () => {
      const service = new MailConfigurationResolverService({} as never, { get: () => 'production' } as never, fakeClock());
      const config = makeConfig({ enabled: true, environment: 'SANDBOX' });
      expect(service.resolvePinned(config as never)).toEqual({ usable: false, reason: 'ENVIRONMENT_MISMATCH' });
    });

    it('is usable when the pinned configuration is still enabled, environment-valid, and outbound-eligible', () => {
      const service = new MailConfigurationResolverService({} as never, { get: () => 'test' } as never, fakeClock());
      const config = makeConfig({ enabled: true, environment: 'SANDBOX' });
      expect(service.resolvePinned(config as never)).toEqual({ usable: true, config });
    });
  });

  describe('Phase 3.1 §D — outbound-enablement / cutover operational gate', () => {
    it('OUTBOUND_SEND_DISABLED when outboundSendEnabled is false, even though everything else is valid', async () => {
      const global = makeConfig({ outboundSendEnabled: false });
      const findFirst = jest.fn((args: { where: { billingEntityId: unknown } }) =>
        Promise.resolve(args.where.billingEntityId === null ? global : null),
      );
      const prisma = { mailConfiguration: { findFirst } };
      const service = new MailConfigurationResolverService(prisma as never, { get: () => 'test' } as never, fakeClock());

      expect(await service.resolveForOutbound('be-1')).toEqual({ usable: false, reason: 'OUTBOUND_SEND_DISABLED' });
    });

    it('OUTBOUND_SEND_CUTOVER_NOT_REACHED when outboundSendCutoverAt is null', async () => {
      const global = makeConfig({ outboundSendEnabled: true, outboundSendCutoverAt: null });
      const findFirst = jest.fn((args: { where: { billingEntityId: unknown } }) =>
        Promise.resolve(args.where.billingEntityId === null ? global : null),
      );
      const prisma = { mailConfiguration: { findFirst } };
      const service = new MailConfigurationResolverService(prisma as never, { get: () => 'test' } as never, fakeClock());

      expect(await service.resolveForOutbound('be-1')).toEqual({
        usable: false,
        reason: 'OUTBOUND_SEND_CUTOVER_NOT_REACHED',
      });
    });

    it('OUTBOUND_SEND_CUTOVER_NOT_REACHED when the current time is still before the cutover', async () => {
      const global = makeConfig({ outboundSendEnabled: true, outboundSendCutoverAt: FUTURE_CUTOVER });
      const findFirst = jest.fn((args: { where: { billingEntityId: unknown } }) =>
        Promise.resolve(args.where.billingEntityId === null ? global : null),
      );
      const prisma = { mailConfiguration: { findFirst } };
      const service = new MailConfigurationResolverService(prisma as never, { get: () => 'test' } as never, fakeClock(NOW));

      expect(await service.resolveForOutbound('be-1')).toEqual({
        usable: false,
        reason: 'OUTBOUND_SEND_CUTOVER_NOT_REACHED',
      });
    });

    it('usable once the current time reaches the configured cutover exactly', async () => {
      const global = makeConfig({ outboundSendEnabled: true, outboundSendCutoverAt: NOW });
      const findFirst = jest.fn((args: { where: { billingEntityId: unknown } }) =>
        Promise.resolve(args.where.billingEntityId === null ? global : null),
      );
      const prisma = { mailConfiguration: { findFirst } };
      const service = new MailConfigurationResolverService(prisma as never, { get: () => 'test' } as never, fakeClock(NOW));

      expect(await service.resolveForOutbound('be-1')).toEqual({ usable: true, config: global });
    });

    it('resolvePinned with { checkCutover: false } ignores a future cutover entirely (OperatorReplyOutboundService contract)', () => {
      const service = new MailConfigurationResolverService({} as never, { get: () => 'test' } as never, fakeClock(NOW));
      const config = makeConfig({ outboundSendEnabled: true, outboundSendCutoverAt: FUTURE_CUTOVER });

      expect(service.resolvePinned(config as never, { checkCutover: false })).toEqual({ usable: true, config });
    });

    it('resolvePinned with { checkCutover: false } still requires outboundSendEnabled', () => {
      const service = new MailConfigurationResolverService({} as never, { get: () => 'test' } as never, fakeClock(NOW));
      const config = makeConfig({ outboundSendEnabled: false, outboundSendCutoverAt: null });

      expect(service.resolvePinned(config as never, { checkCutover: false })).toEqual({
        usable: false,
        reason: 'OUTBOUND_SEND_DISABLED',
      });
    });
  });
});
