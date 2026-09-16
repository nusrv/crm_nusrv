import { jest } from '@jest/globals';
import { HealthStatus, IntegrationKind } from '../../generated/prisma/enums';
import { AiHealthService } from './ai-health.service';

describe('AiHealthService', () => {
  it('appends a new event when the status differs from the last AI event', async () => {
    const findFirst = jest.fn(() => Promise.resolve({ status: HealthStatus.UNKNOWN }));
    const create = jest.fn((args: Record<string, unknown>) => {
      void args;
      return Promise.resolve({ id: 'event-1' });
    });
    const prisma = { integrationHealthEvent: { findFirst, create } };
    const service = new AiHealthService(prisma as never);

    await service.record(HealthStatus.DEGRADED, 'Provider timed out.');

    expect(create).toHaveBeenCalledTimes(1);
    const createCall = create.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(createCall.data).toMatchObject({
      integration: IntegrationKind.AI,
      status: HealthStatus.DEGRADED,
      mailConfigurationId: null,
    });
  });

  it('does not flood a new event when the last AI event already has the same status', async () => {
    const findFirst = jest.fn(() => Promise.resolve({ status: HealthStatus.HEALTHY }));
    const create = jest.fn(() => Promise.resolve({ id: 'event-1' }));
    const prisma = { integrationHealthEvent: { findFirst, create } };
    const service = new AiHealthService(prisma as never);

    await service.record(HealthStatus.HEALTHY, 'Provider call succeeded.');

    expect(create).not.toHaveBeenCalled();
  });

  it('scopes its dedup lookup to integration=AI, mailConfigurationId=null only', async () => {
    const findFirst = jest.fn(({ where }: { where: { integration: IntegrationKind; mailConfigurationId: null } }) => {
      expect(where.integration).toBe(IntegrationKind.AI);
      expect(where.mailConfigurationId).toBeNull();
      return Promise.resolve(null);
    });
    const create = jest.fn(() => Promise.resolve({ id: 'event-1' }));
    const prisma = { integrationHealthEvent: { findFirst, create } };
    const service = new AiHealthService(prisma as never);

    await service.record(HealthStatus.HEALTHY, 'first ever AI event');

    expect(create).toHaveBeenCalledTimes(1);
  });

  it('never writes to MailConfiguration (AI is global/provider-level, never mailbox-scoped)', async () => {
    const findFirst = jest.fn(() => Promise.resolve(null));
    const create = jest.fn(() => Promise.resolve({ id: 'event-1' }));
    const mailConfigurationUpdate = jest.fn();
    const prisma = {
      integrationHealthEvent: { findFirst, create },
      mailConfiguration: { update: mailConfigurationUpdate },
    };
    const service = new AiHealthService(prisma as never);

    await service.record(HealthStatus.UNAVAILABLE, 'auth failed');

    expect(mailConfigurationUpdate).not.toHaveBeenCalled();
  });

  it('recovery after an unhealthy state emits a HEALTHY event', async () => {
    const findFirst = jest.fn(() => Promise.resolve({ status: HealthStatus.UNAVAILABLE }));
    const create = jest.fn((args: { data: Record<string, unknown> }) => Promise.resolve({ id: 'event-1', ...args.data }));
    const prisma = { integrationHealthEvent: { findFirst, create } };
    const service = new AiHealthService(prisma as never);

    await service.record(HealthStatus.HEALTHY, 'recovered');

    expect(create).toHaveBeenCalledTimes(1);
    const createCall = create.mock.calls[0]![0];
    expect(createCall.data).toMatchObject({ status: HealthStatus.HEALTHY });
  });
});
