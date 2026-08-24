import { jest } from '@jest/globals';
import { RenewalWorker } from './renewal.worker';

describe('RenewalWorker', () => {
  it('executes renewal evaluation in the BullMQ worker lifecycle', async () => {
    const summary = { subscriptionsEvaluated: 2 };
    const engine = { evaluateAll: jest.fn(() => Promise.resolve(summary)) };
    const worker = new RenewalWorker(engine as never);
    await expect(
      worker.process({
        name: 'evaluate-renewals',
        data: { trigger: 'manual', actorId: 'admin-id' },
      } as never),
    ).resolves.toBe(summary);
    expect(engine.evaluateAll).toHaveBeenCalledWith({
      trigger: 'manual',
      actorId: 'admin-id',
      ipAddress: undefined,
    });
  });

  it('rejects unknown queue jobs', async () => {
    const worker = new RenewalWorker({ evaluateAll: jest.fn() } as never);
    await expect(worker.process({ name: 'send-email', data: {} } as never)).rejects.toThrow(
      'Unsupported renewal job',
    );
  });
});
