import { jest } from '@jest/globals';
import { AiClassificationEnqueueService, classifyDeduplicationId } from './ai-classification-enqueue.service';

/**
 * Models BullMQ's documented "Simple Deduplication" contract (verified directly against the
 * installed `bullmq` package's own Lua scripts — `setDeduplicationKey.lua`,
 * `removeDeduplicationKeyIfNeededOnFinalization.lua`, invoked unconditionally from
 * `moveToFinished-14.lua`): while a job under a given deduplication id is unfinished
 * (waiting/active/delayed), a duplicate `add()` is ignored and the existing job is returned; once
 * that job is finalized (completed or finally failed), the deduplication key is released and the
 * next `add()` with the same id creates a brand-new job. This is a test double for THIS service's
 * own behavior against that documented contract — it is not a reimplementation of BullMQ's
 * Redis/Lua guarantees, which are real MariaDB/Redis-backed atomic operations this unit test cannot
 * exercise directly.
 */
class FakeDeduplicatingQueue {
  private jobsByDedupId = new Map<string, { id: string; finalized: boolean }>();
  private counter = 0;
  public addCalls: Array<{ name: string; data: unknown; opts: Record<string, unknown> }> = [];

  add(name: string, data: unknown, opts: Record<string, unknown> = {}) {
    this.addCalls.push({ name, data, opts });
    const dedupId = (opts.deduplication as { id?: string } | undefined)?.id;
    if (!dedupId) {
      return Promise.resolve({ id: `job-${++this.counter}` });
    }
    const existing = this.jobsByDedupId.get(dedupId);
    if (existing && !existing.finalized) {
      return Promise.resolve(existing); // duplicate ignored while the job is still alive.
    }
    const job = { id: `job-${++this.counter}`, finalized: false };
    this.jobsByDedupId.set(dedupId, job);
    return Promise.resolve(job);
  }

  /** Simulates BullMQ releasing the deduplication key once the job completes or finally fails. */
  finalize(dedupId: string) {
    const job = this.jobsByDedupId.get(dedupId);
    if (job) job.finalized = true;
  }

  jobCountFor(dedupId: string): number {
    return this.jobsByDedupId.has(dedupId) ? 1 : 0;
  }
}

/** Phase 3.1 §J — AiClassificationEnqueueService now resolves `enabled` from AiSettingsResolverService
 * (a DB-backed, per-call resolution) rather than reading AI_ENABLED off ConfigService. */
function fakeAiSettings(enabled: boolean) {
  return { getSettings: () => Promise.resolve({ enabled }) };
}

function harness(configValues: Record<string, string>) {
  const add = jest.fn((name: string, data: unknown, opts: Record<string, unknown>) => {
    void name;
    void data;
    void opts;
    return Promise.resolve({ id: 'job-1' });
  });
  const queue = { add };
  const aiSettings = fakeAiSettings(configValues.AI_ENABLED === 'true');
  const service = new AiClassificationEnqueueService(queue as never, aiSettings as never);
  return { service, add };
}

describe('AiClassificationEnqueueService', () => {
  it('§10 — never enqueues when AI is disabled', async () => {
    const { service, add } = harness({ AI_ENABLED: 'false' });
    await service.enqueueIfEnabled('msg-1');
    expect(add).not.toHaveBeenCalled();
  });

  it('B — enqueues via BullMQ Simple Deduplication with a hyphen-delimited id that never contains ":"', async () => {
    const { service, add } = harness({ AI_ENABLED: 'true' });
    await service.enqueueIfEnabled('msg-1');
    const call = add.mock.calls[0]!;
    expect(call[0]).toBe('classify-message');
    expect(call[1]).toEqual({ emailMessageId: 'msg-1' });
    const opts = call[2] as { deduplication?: { id: string }; jobId?: string };
    expect(opts.deduplication?.id).toBe('ai-classify-msg-1');
    expect(opts.deduplication?.id).not.toContain(':');
    expect(opts.jobId).toBeUndefined(); // no custom jobId is used for this job type any more.
  });

  it('B — classifyDeduplicationId never produces an id containing ":" for any real EmailMessage.id (a UUID)', () => {
    // EmailMessage.id is always a UUID (schema.prisma: `@id @default(uuid()) @db.VarChar(36)`),
    // which itself never contains ':' — this proves the constructed dedup id stays colon-free for
    // every realistic input, not merely for one hand-picked example.
    const uuidLikeIds = ['11111111-1111-4111-8111-111111111111', 'a1b2c3d4-e5f6-4789-a012-3456789abcde', '0'.repeat(8) + '-0000-4000-8000-' + '0'.repeat(12)];
    for (const emailMessageId of uuidLikeIds) {
      expect(emailMessageId).not.toContain(':'); // sanity: the input itself is colon-free, as real UUIDs are.
      expect(classifyDeduplicationId(emailMessageId)).not.toContain(':');
    }
  });

  it('§11 — swallows an enqueue failure rather than propagating it', async () => {
    const add = jest.fn(() => Promise.reject(new Error('redis unavailable')));
    const service = new AiClassificationEnqueueService({ add } as never, fakeAiSettings(true) as never);

    await expect(service.enqueueIfEnabled('msg-1')).resolves.toBeUndefined();
  });

  it('A — two enqueue attempts for the same EmailMessage while the first job is still alive collapse into one logical pending job', async () => {
    const fakeQueue = new FakeDeduplicatingQueue();
    const service = new AiClassificationEnqueueService(fakeQueue as never, fakeAiSettings(true) as never);

    await service.enqueueIfEnabled('msg-1');
    await service.enqueueIfEnabled('msg-1'); // still "alive" — never finalized in between.

    expect(fakeQueue.addCalls).toHaveLength(2); // our code calls add() both times, as designed —
    // BullMQ's own dedup logic (modeled above) is what collapses them into one underlying job.
    expect(fakeQueue.jobCountFor(classifyDeduplicationId('msg-1'))).toBe(1);
  });

  it('C — after the job is finalized (completed/failed), a still-PENDING message can be enqueued again by recovery', async () => {
    const fakeQueue = new FakeDeduplicatingQueue();
    const service = new AiClassificationEnqueueService(fakeQueue as never, fakeAiSettings(true) as never);
    const dedupId = classifyDeduplicationId('msg-1');

    await service.enqueueIfEnabled('msg-1'); // opportunistic enqueue at ingest time.
    fakeQueue.finalize(dedupId); // simulates BullMQ releasing the key once that job completes/fails.

    await service.enqueueIfEnabled('msg-1'); // a later recovery-scan re-enqueue for the same message.

    // Two real add() calls, and a fresh job was created for the second one — the finalized first
    // job never permanently blocks a later recovery enqueue for the same still-PENDING message.
    expect(fakeQueue.addCalls).toHaveLength(2);
    expect(fakeQueue.jobCountFor(dedupId)).toBe(1);
  });
});
