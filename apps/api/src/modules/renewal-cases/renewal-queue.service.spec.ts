import { jest } from '@jest/globals';
import { RenewalQueueService } from './renewal-queue.service';

describe('RenewalQueueService', () => {
  it('registers one timezone-aware BullMQ daily scheduler', async () => {
    const queue = { upsertJobScheduler: jest.fn(() => Promise.resolve({})) };
    const service = new RenewalQueueService(
      queue as never,
      { timezone: 'Asia/Amman' } as never,
      { record: jest.fn() } as never,
    );
    await service.onModuleInit();
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      'daily-renewal-evaluation',
      { pattern: '0 5 0 * * *', tz: 'Asia/Amman' },
      { name: 'evaluate-renewals', data: { trigger: 'scheduled' } },
    );
  });

  it('queues an audited manual run without executing in the HTTP lifecycle', async () => {
    const queue = {
      upsertJobScheduler: jest.fn(),
      add: jest.fn<
        (name: string, data: unknown, options: { jobId: string }) => Promise<{ id: string }>
      >(() => Promise.resolve({ id: 'bull-job-id' })),
    };
    const audit = { record: jest.fn(() => Promise.resolve({ id: 'audit-id' })) };
    const service = new RenewalQueueService(
      queue as never,
      { timezone: 'Asia/Amman' } as never,
      audit as never,
    );
    const result = await service.triggerManual('Operator verification', {
      actorId: 'actor-id',
      ipAddress: '2001:db8::2',
    });
    expect(result).toMatchObject({
      jobId: 'bull-job-id',
      auditEventId: 'audit-id',
      status: 'QUEUED',
    });
    expect(queue.add).toHaveBeenCalledWith(
      'evaluate-renewals',
      expect.objectContaining({ trigger: 'manual', actorId: 'actor-id' }),
      expect.objectContaining({}),
    );
    expect(queue.add.mock.calls[0]?.[2].jobId).toMatch(/^manual-/);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventKey: 'renewal.engine.manual_execution.requested' }),
    );
  });
});
