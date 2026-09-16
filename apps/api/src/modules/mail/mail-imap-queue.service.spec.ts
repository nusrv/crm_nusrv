import { jest } from '@jest/globals';
import { MailImapQueueService } from './mail-imap-queue.service';
import { IMAP_SYNC_INTERVAL_MS, IMAP_SYNC_JOB, IMAP_SYNC_SCHEDULER } from './mail-imap-queue.constants';

describe('MailImapQueueService', () => {
  it('§4 — configures a real DISTRIBUTED overlap guard (setGlobalConcurrency), not merely local Worker concurrency', async () => {
    const setGlobalConcurrency = jest.fn(() => Promise.resolve(1));
    const upsertJobScheduler = jest.fn(() => Promise.resolve({}));
    const queue = { setGlobalConcurrency, upsertJobScheduler };
    const service = new MailImapQueueService(queue as never);

    await service.onModuleInit();

    // This is the actual distributed mechanism (Redis-backed via BullMQ, shared across every
    // worker process on this queue) — proves the guard is queue-level, not process-local.
    expect(setGlobalConcurrency).toHaveBeenCalledWith(1);
    expect(upsertJobScheduler).toHaveBeenCalledWith(
      IMAP_SYNC_SCHEDULER,
      { every: IMAP_SYNC_INTERVAL_MS },
      { name: IMAP_SYNC_JOB, data: { trigger: 'scheduled' } },
    );
  });

  it('sets global concurrency before registering the scheduler', async () => {
    const order: string[] = [];
    const setGlobalConcurrency = jest.fn(() => {
      order.push('setGlobalConcurrency');
      return Promise.resolve(1);
    });
    const upsertJobScheduler = jest.fn(() => {
      order.push('upsertJobScheduler');
      return Promise.resolve({});
    });
    const queue = { setGlobalConcurrency, upsertJobScheduler };
    const service = new MailImapQueueService(queue as never);

    await service.onModuleInit();

    expect(order).toEqual(['setGlobalConcurrency', 'upsertJobScheduler']);
  });
});
