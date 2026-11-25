import { jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import { MailActionQueueController } from './mail-action-queue.controller';
import { attachVerifiedAccessContext } from '../../identity/verified-access-context';

function fixture(enabled = 'false', roles = ['ADMIN']) {
  const findMany = jest.fn(() => Promise.resolve([]));
  const prisma = { mailDsnFollowUp: { findMany }, communicationOutbox: { findMany }, operatorReplyOutbox: { findMany }, $transaction: jest.fn() };
  const user = attachVerifiedAccessContext({ id: 'fixture', roles }, 'session', Date.now() + 60000);
  const controller = new MailActionQueueController(prisma as never, {} as never, new ConfigService({ P2_ACTION_QUEUE_ENABLED: enabled }));
  return { controller, req: { user } as never, findMany, transaction: prisma.$transaction };
}

describe('P2 operator queue boundary', () => {
  it('does not read or write tables with the feature disabled', async () => {
    const f = fixture();
    expect(await f.controller.list(f.req, undefined, undefined, undefined)).toEqual({ enabled: false, items: [], hasMore: false });
    await expect(f.controller.resolve(f.req, {})).rejects.toThrow('not enabled');
    expect(f.findMany).not.toHaveBeenCalled();
    expect(f.transaction).not.toHaveBeenCalled();
  });
  it('rejects non-ADMIN and unverified principals before querying', async () => {
    const f = fixture('true', ['IT']);
    await expect(f.controller.list(f.req, undefined, undefined, undefined)).rejects.toThrow('ADMIN required');
    await expect(f.controller.list({ user: { id: 'fixture', roles: ['ADMIN'] } } as never, undefined, undefined, undefined)).rejects.toThrow('Invalid session');
    expect(f.findMany).not.toHaveBeenCalled();
  });
  it('bounds pagination and distinguishes uncertainty from corroborated follow-up', async () => {
    const f = fixture('true');
    await expect(f.controller.list(f.req, 'FOLLOW_UP', '401', 'OPEN')).rejects.toThrow('Invalid action queue filter');
    expect(await f.controller.list(f.req, 'UNCERTAIN_REPLY', '2', 'OPEN')).toEqual({ enabled: true, items: [], hasMore: false });
    expect(f.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 25, take: 26, where: { smtpUncertain: true } }));
    await f.controller.list(f.req, 'FOLLOW_UP', '1', 'RESOLVED');
    expect(f.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { status: 'RESOLVED' }, take: 26 }));
  });
});
