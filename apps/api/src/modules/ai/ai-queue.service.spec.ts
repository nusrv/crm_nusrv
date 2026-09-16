import { jest } from '@jest/globals';
import { AiQueueService } from './ai-queue.service';
import { AI_RECOVERY_SCAN_INTERVAL_MS } from './ai-timing.constants';
import { AI_RECOVERY_JOB, AI_RECOVERY_SCHEDULER } from './ai-queue.constants';

describe('AiQueueService', () => {
  it('registers the periodic recovery-scan scheduler idempotently on boot', async () => {
    const upsertJobScheduler = jest.fn(() => Promise.resolve({}));
    const queue = { upsertJobScheduler };
    const service = new AiQueueService(queue as never);

    await service.onModuleInit();

    expect(upsertJobScheduler).toHaveBeenCalledWith(
      AI_RECOVERY_SCHEDULER,
      { every: AI_RECOVERY_SCAN_INTERVAL_MS },
      { name: AI_RECOVERY_JOB, data: { trigger: 'scheduled' } },
    );
  });
});
