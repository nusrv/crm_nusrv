import { jest } from '@jest/globals';
import { OperatorReplyQueueService } from './operator-reply-queue.service';
import { OPERATOR_REPLY_SCAN_INTERVAL_MS } from './operator-reply-queue.constants';
import { OPERATOR_REPLY_SEND_JOB, OPERATOR_REPLY_SEND_SCHEDULER } from './operator-reply-queue.constants';

describe('OperatorReplyQueueService', () => {
  it('registers the periodic operator-reply-processing scheduler idempotently on boot', async () => {
    const upsertJobScheduler = jest.fn(() => Promise.resolve({}));
    const queue = { upsertJobScheduler };
    const service = new OperatorReplyQueueService(queue as never);

    await service.onModuleInit();

    expect(upsertJobScheduler).toHaveBeenCalledWith(
      OPERATOR_REPLY_SEND_SCHEDULER,
      { every: OPERATOR_REPLY_SCAN_INTERVAL_MS },
      { name: OPERATOR_REPLY_SEND_JOB, data: { trigger: 'scheduled' } },
    );
  });
});
