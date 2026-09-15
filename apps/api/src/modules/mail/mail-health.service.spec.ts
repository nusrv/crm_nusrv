import { jest } from '@jest/globals';
import { HealthStatus } from '../../generated/prisma/enums';
import { MailHealthService } from './mail-health.service';

describe('MailHealthService', () => {
  it('appends a new event and updates lastHealthStatus when the status changes', async () => {
    const findUniqueOrThrow = jest.fn(() => Promise.resolve({ lastHealthStatus: HealthStatus.UNKNOWN }));
    const create = jest.fn((args: Record<string, unknown>) => {
      void args;
      return Promise.resolve({ id: 'event-1' });
    });
    const update = jest.fn((args: Record<string, unknown>) => {
      void args;
      return Promise.resolve({});
    });
    const tx = { integrationHealthEvent: { create }, mailConfiguration: { update } };
    const prisma = {
      mailConfiguration: { findUniqueOrThrow },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = new MailHealthService(prisma as never);

    await service.record('config-1', HealthStatus.HEALTHY, 'SMTP send succeeded.');

    const createCall = create.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(createCall.data).toMatchObject({ status: HealthStatus.HEALTHY, mailConfigurationId: 'config-1' });
    const updateCall = update.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(updateCall.data).toMatchObject({ lastHealthStatus: HealthStatus.HEALTHY });
  });

  it('does not flood a new event when the status is unchanged, but still heartbeats', async () => {
    const findUniqueOrThrow = jest.fn(() => Promise.resolve({ lastHealthStatus: HealthStatus.HEALTHY }));
    const create = jest.fn((args: Record<string, unknown>) => {
      void args;
      return Promise.resolve({ id: 'event-1' });
    });
    const update = jest.fn((args: Record<string, unknown>) => {
      void args;
      return Promise.resolve({});
    });
    const tx = { integrationHealthEvent: { create }, mailConfiguration: { update } };
    const prisma = {
      mailConfiguration: { findUniqueOrThrow },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = new MailHealthService(prisma as never);

    await service.record('config-1', HealthStatus.HEALTHY, 'SMTP send succeeded.');

    expect(create).not.toHaveBeenCalled();
    const updateCall = update.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(updateCall.data).toMatchObject({ lastHealthStatus: HealthStatus.HEALTHY });
  });
});
