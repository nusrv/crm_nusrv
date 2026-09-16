import { jest } from '@jest/globals';
import { HealthStatus, IntegrationKind } from '../../generated/prisma/enums';
import { MailImapHealthService } from './mail-imap-health.service';

describe('MailImapHealthService', () => {
  it('appends a new event when the status differs from the last IMAP event for this config', async () => {
    const findFirst = jest.fn(() => Promise.resolve({ status: HealthStatus.UNKNOWN }));
    const create = jest.fn((args: Record<string, unknown>) => {
      void args;
      return Promise.resolve({ id: 'event-1' });
    });
    const prisma = { integrationHealthEvent: { findFirst, create } };
    const service = new MailImapHealthService(prisma as never);

    await service.record('config-1', HealthStatus.DEGRADED, 'IMAP connection failed.');

    expect(create).toHaveBeenCalledTimes(1);
    const createCall = create.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(createCall.data).toMatchObject({
      integration: IntegrationKind.IMAP,
      status: HealthStatus.DEGRADED,
      mailConfigurationId: 'config-1',
    });
  });

  it('does not flood a new event when the last IMAP event already has the same status', async () => {
    const findFirst = jest.fn(() => Promise.resolve({ status: HealthStatus.HEALTHY }));
    const create = jest.fn(() => Promise.resolve({ id: 'event-1' }));
    const prisma = { integrationHealthEvent: { findFirst, create } };
    const service = new MailImapHealthService(prisma as never);

    await service.record('config-1', HealthStatus.HEALTHY, 'IMAP sync succeeded.');

    expect(create).not.toHaveBeenCalled();
  });

  it('scopes its dedup lookup to integration=IMAP only, so an SMTP event never suppresses an IMAP one', async () => {
    const findFirst = jest.fn(({ where }: { where: { integration: IntegrationKind } }) => {
      expect(where.integration).toBe(IntegrationKind.IMAP);
      return Promise.resolve(null);
    });
    const create = jest.fn(() => Promise.resolve({ id: 'event-1' }));
    const prisma = { integrationHealthEvent: { findFirst, create } };
    const service = new MailImapHealthService(prisma as never);

    await service.record('config-1', HealthStatus.HEALTHY, 'first ever IMAP event');

    expect(create).toHaveBeenCalledTimes(1);
  });

  it('never writes to MailConfiguration.lastHealthStatus/lastHealthCheckedAt (no mailConfiguration client call)', async () => {
    const findFirst = jest.fn(() => Promise.resolve(null));
    const create = jest.fn(() => Promise.resolve({ id: 'event-1' }));
    const mailConfigurationUpdate = jest.fn();
    const prisma = {
      integrationHealthEvent: { findFirst, create },
      mailConfiguration: { update: mailConfigurationUpdate },
    };
    const service = new MailImapHealthService(prisma as never);

    await service.record('config-1', HealthStatus.UNAVAILABLE, 'auth failed');

    expect(mailConfigurationUpdate).not.toHaveBeenCalled();
  });
});
