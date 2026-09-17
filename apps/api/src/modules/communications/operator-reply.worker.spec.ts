import { jest } from '@jest/globals';
import { OperatorReplyWorker } from './operator-reply.worker';
import { OPERATOR_REPLY_SEND_JOB } from './operator-reply-queue.constants';

describe('OperatorReplyWorker', () => {
  it('dispatches the process-operator-reply job to OperatorReplyOutboundService.processBatch()', async () => {
    const processBatch = jest.fn(() => Promise.resolve({ disabled: false, candidates: 0, sent: 0, deferred: 0, cancelled: 0, failed: 0, notClaimed: 0, conflicts: 0, ownershipLostAfterSend: 0 }));
    const outbound = { processBatch };
    const worker = new OperatorReplyWorker(outbound as never);

    const result = await worker.process({ name: OPERATOR_REPLY_SEND_JOB, data: { trigger: 'scheduled' } } as never);

    expect(processBatch).toHaveBeenCalledTimes(1);
    expect(result.candidates).toBe(0);
  });

  it('rejects an unsupported job name', async () => {
    const outbound = { processBatch: jest.fn() };
    const worker = new OperatorReplyWorker(outbound as never);

    await expect(worker.process({ name: 'unknown-job', data: {} } as never)).rejects.toThrow('Unsupported operator-reply job');
  });
});
