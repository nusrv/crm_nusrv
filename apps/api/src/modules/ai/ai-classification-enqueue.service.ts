import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { AiSettingsResolverService } from './ai-settings-resolver.service';
import { AI_CLASSIFY_JOB, AI_QUEUE } from './ai-queue.constants';

export interface ClassifyMessageJobData {
  emailMessageId: string;
}

/**
 * The Redis key BullMQ's Simple Deduplication uses for this message's classification job. Deliberately
 * hyphen-, not colon-, delimited — a custom BullMQ identifier must never contain ':'. Exported so tests
 * can assert its exact shape without duplicating the format inline.
 */
export function classifyDeduplicationId(emailMessageId: string): string {
  return `ai-classify-${emailMessageId}`;
}

/**
 * Slice D §11 / hardening-pass §1 — injected into MailInboundIngestService (Slice C) so ingestion
 * can opportunistically enqueue a classification job AFTER its own transaction has already
 * committed.
 *
 * Uses BullMQ's Simple Deduplication (`deduplication.id`), NOT a custom `jobId`. While a job under
 * this deduplication id is waiting/active/delayed, a duplicate `add()` call is ignored at the queue
 * layer for free — but unlike a finalized custom jobId (which can remain in BullMQ's
 * completed/failed job records indefinitely and therefore permanently block any future job from
 * reusing that same id), the deduplication key itself is released the moment the job completes or
 * finally fails (verified against the installed `bullmq` package's own
 * `removeDeduplicationKeyIfNeededOnFinalization.lua`, invoked unconditionally from
 * `moveToFinished-14.lua` on every terminal transition, independent of `removeOnComplete`/
 * `removeOnFail` retention settings). This means a later recovery-scan enqueue for the same
 * still-PENDING EmailMessage is never permanently blocked by an old finished job.
 *
 * The DB-level PENDING compare-and-swap in AiClassificationService remains the sole correctness
 * boundary (§13) — this queue-level dedup is purely a throughput/duplicate-work optimization, never
 * relied upon for correctness.
 *
 * Enqueue failure (Redis unavailable, etc.) is swallowed here — it must NEVER propagate back into
 * MailInboundIngestService and roll back or otherwise affect the already-committed inbound
 * EmailMessage; the periodic recovery scan (AiQueueService/AiClassificationWorker) exists
 * specifically to pick up a message whose opportunistic enqueue was lost this way.
 */
@Injectable()
export class AiClassificationEnqueueService {
  constructor(
    @InjectQueue(AI_QUEUE) private readonly queue: Queue<ClassifyMessageJobData>,
    private readonly aiSettings: AiSettingsResolverService,
  ) {}

  async enqueueIfEnabled(emailMessageId: string): Promise<void> {
    const settings = await this.aiSettings.getSettings();
    if (!settings.enabled) return;
    try {
      await this.queue.add(
        AI_CLASSIFY_JOB,
        { emailMessageId },
        { deduplication: { id: classifyDeduplicationId(emailMessageId) } },
      );
    } catch {
      // Swallowed by design — see class doc comment.
    }
  }
}
