import { jest } from '@jest/globals';
import { ClassificationStatus, MessageDirection } from '../../generated/prisma/enums';
import { AiClassificationWorker } from './ai.worker';
import { AI_CLASSIFY_JOB, AI_RECOVERY_JOB, AI_ROUTE_JOB, AI_ROUTING_RECOVERY_JOB } from './ai-queue.constants';

function fakeJob(name: string, data: unknown, attemptsMade: number, attempts: number) {
  return { name, data, attemptsMade, opts: { attempts } } as never;
}

/** Phase 3.1 §J — AiClassificationWorker's recovery scan now resolves `enabled` from
 * AiSettingsResolverService (DB-backed) rather than ConfigService. This fake keeps every existing
 * `fakeConfig({ AI_ENABLED: ... })` call site in this file unchanged syntactically. */
function fakeConfig(values: Record<string, string>) {
  return { getSettings: () => Promise.resolve({ enabled: values.AI_ENABLED === 'true' }) };
}

// Slice G — a shared no-op fake; none of the classify-message/recover-pending tests below ever
// invoke routing methods, so one harmless stand-in suffices for every such constructor call.
function fakeRouting() {
  return { processOne: jest.fn(), processBatch: jest.fn() };
}

describe('AiClassificationWorker', () => {
  it('dispatches a classify-message job to AiClassificationService with isLastAttempt=false on an early attempt', async () => {
    const classifyMessage = jest.fn(() => Promise.resolve('classified'));
    const classification = { classifyMessage };
    const enqueue = { enqueueIfEnabled: jest.fn() };
    const prisma = { emailMessage: { findMany: jest.fn() } };
    const worker = new AiClassificationWorker(classification as never, enqueue as never, fakeRouting() as never, prisma as never, fakeConfig({ AI_ENABLED: 'true' }) as never);

    await worker.process(fakeJob(AI_CLASSIFY_JOB, { emailMessageId: 'msg-1' }, 0, 3));

    expect(classifyMessage).toHaveBeenCalledWith('msg-1', false);
  });

  it('computes isLastAttempt=true on the final configured attempt', async () => {
    const classifyMessage = jest.fn(() => Promise.resolve('failed_human_review'));
    const classification = { classifyMessage };
    const enqueue = { enqueueIfEnabled: jest.fn() };
    const prisma = { emailMessage: { findMany: jest.fn() } };
    const worker = new AiClassificationWorker(classification as never, enqueue as never, fakeRouting() as never, prisma as never, fakeConfig({ AI_ENABLED: 'true' }) as never);

    await worker.process(fakeJob(AI_CLASSIFY_JOB, { emailMessageId: 'msg-1' }, 2, 3));

    expect(classifyMessage).toHaveBeenCalledWith('msg-1', true);
  });

  it('D — a classify-message job for a message no longer PENDING (e.g. a race with a human review) makes zero provider calls', async () => {
    // AiClassificationService.classifyMessage() itself owns the PENDING eligibility check (§9) —
    // this proves the worker dispatches to it unconditionally and trusts that check completely,
    // never second-guessing or bypassing it based on the job having been queued at all.
    const classifyMessage = jest.fn(() => Promise.resolve('skipped_ineligible'));
    const classification = { classifyMessage };
    const enqueue = { enqueueIfEnabled: jest.fn() };
    const prisma = { emailMessage: { findMany: jest.fn() } };
    const worker = new AiClassificationWorker(classification as never, enqueue as never, fakeRouting() as never, prisma as never, fakeConfig({ AI_ENABLED: 'true' }) as never);

    const outcome = await worker.process(fakeJob(AI_CLASSIFY_JOB, { emailMessageId: 'msg-1' }, 0, 3));

    expect(outcome).toBe('skipped_ineligible');
    expect(classifyMessage).toHaveBeenCalledTimes(1); // dispatched once, per §9's own internal guard.
  });

  it('§11/§30 — a recover-pending job scans a bounded set of eligible PENDING messages and re-enqueues each', async () => {
    const classification = { classifyMessage: jest.fn() };
    const enqueueIfEnabled = jest.fn(() => Promise.resolve());
    const enqueue = { enqueueIfEnabled };
    const findMany = jest.fn(({ where, take }: { where: unknown; take: number }) => {
      expect(where).toMatchObject({ direction: MessageDirection.INBOUND, classificationStatus: ClassificationStatus.PENDING });
      expect(take).toBeGreaterThan(0);
      return Promise.resolve([{ id: 'msg-1' }, { id: 'msg-2' }]);
    });
    const prisma = { emailMessage: { findMany } };
    const worker = new AiClassificationWorker(classification as never, enqueue as never, fakeRouting() as never, prisma as never, fakeConfig({ AI_ENABLED: 'true' }) as never);

    const result = await worker.process(fakeJob(AI_RECOVERY_JOB, { trigger: 'scheduled' }, 0, 3));

    expect(result).toEqual({ scanned: 2 });
    expect(enqueueIfEnabled).toHaveBeenCalledWith('msg-1');
    expect(enqueueIfEnabled).toHaveBeenCalledWith('msg-2');
  });

  it('hardening-pass §2 — when AI_ENABLED=false, a recover-pending job is a true no-op: zero DB reads, zero enqueues', async () => {
    const classification = { classifyMessage: jest.fn() };
    const enqueueIfEnabled = jest.fn(() => Promise.resolve());
    const enqueue = { enqueueIfEnabled };
    const findMany = jest.fn(() => Promise.resolve([{ id: 'msg-1' }]));
    const prisma = { emailMessage: { findMany } };
    const worker = new AiClassificationWorker(classification as never, enqueue as never, fakeRouting() as never, prisma as never, fakeConfig({ AI_ENABLED: 'false' }) as never);

    const result = await worker.process(fakeJob(AI_RECOVERY_JOB, { trigger: 'scheduled' }, 0, 3));

    expect(result).toEqual({ scanned: 0 });
    expect(findMany).not.toHaveBeenCalled(); // not even the bounded query runs while disabled.
    expect(enqueueIfEnabled).not.toHaveBeenCalled();
  });

  it('hardening-pass §2 — AI disabled at commit time, then enabled: recovery discovers and enqueues the historical PENDING message', async () => {
    const classification = { classifyMessage: jest.fn() };
    const enqueueIfEnabled = jest.fn(() => Promise.resolve());
    const enqueue = { enqueueIfEnabled };
    const findMany = jest.fn(() => Promise.resolve([{ id: 'msg-stranded-while-disabled' }]));
    const prisma = { emailMessage: { findMany } };
    const configValues: Record<string, string> = { AI_ENABLED: 'false' };
    const config = { getSettings: () => Promise.resolve({ enabled: configValues.AI_ENABLED === 'true' }) };
    const worker = new AiClassificationWorker(classification as never, enqueue as never, fakeRouting() as never, prisma as never, config as never);

    const disabledResult = await worker.process(fakeJob(AI_RECOVERY_JOB, { trigger: 'scheduled' }, 0, 3));
    expect(disabledResult).toEqual({ scanned: 0 });
    expect(enqueueIfEnabled).not.toHaveBeenCalled();

    // Simulate the application being reconfigured with AI enabled from Settings (no restart needed —
    // Phase 3.1 §J) and the next scheduled recovery-scan tick firing.
    configValues.AI_ENABLED = 'true';
    const enabledResult = await worker.process(fakeJob(AI_RECOVERY_JOB, { trigger: 'scheduled' }, 0, 3));

    expect(enabledResult).toEqual({ scanned: 1 });
    expect(enqueueIfEnabled).toHaveBeenCalledWith('msg-stranded-while-disabled');
  });

  it('Slice G §8 — dispatches a route-classification job to AiRoutingService.processOne with the decision id', async () => {
    const classification = { classifyMessage: jest.fn() };
    const enqueue = { enqueueIfEnabled: jest.fn() };
    const prisma = { emailMessage: { findMany: jest.fn() } };
    const processOne = jest.fn(() => Promise.resolve('succeeded'));
    const routing = { processOne, processBatch: jest.fn() };
    const worker = new AiClassificationWorker(classification as never, enqueue as never, routing as never, prisma as never, fakeConfig({ AI_ENABLED: 'true' }) as never);

    const outcome = await worker.process(fakeJob(AI_ROUTE_JOB, { routingDecisionId: 'decision-1' }, 0, 3));

    expect(processOne).toHaveBeenCalledWith('decision-1');
    expect(outcome).toBe('succeeded');
  });

  it('Slice G §20 — dispatches a recover-pending-routing job to AiRoutingService.processBatch', async () => {
    const classification = { classifyMessage: jest.fn() };
    const enqueue = { enqueueIfEnabled: jest.fn() };
    const prisma = { emailMessage: { findMany: jest.fn() } };
    const processBatch = jest.fn(() => Promise.resolve({ candidates: 1, succeeded: 1, skipped: 0, failed: 0, notClaimed: 0, conflicts: 0 }));
    const routing = { processOne: jest.fn(), processBatch };
    const worker = new AiClassificationWorker(classification as never, enqueue as never, routing as never, prisma as never, fakeConfig({ AI_ENABLED: 'true' }) as never);

    const outcome = await worker.process(fakeJob(AI_ROUTING_RECOVERY_JOB, { trigger: 'scheduled' }, 0, 3));

    expect(processBatch).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ candidates: 1, succeeded: 1, skipped: 0, failed: 0, notClaimed: 0, conflicts: 0 });
  });

  it('rejects an unsupported job name', async () => {
    const classification = { classifyMessage: jest.fn() };
    const enqueue = { enqueueIfEnabled: jest.fn() };
    const prisma = { emailMessage: { findMany: jest.fn() } };
    const worker = new AiClassificationWorker(classification as never, enqueue as never, fakeRouting() as never, prisma as never, fakeConfig({ AI_ENABLED: 'true' }) as never);

    await expect(worker.process(fakeJob('unknown-job', {}, 0, 3))).rejects.toThrow('Unsupported AI job');
  });
});
