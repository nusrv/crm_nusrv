import { Injectable, type OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { AI_RECOVERY_SCAN_INTERVAL_MS } from './ai-timing.constants';
import { AI_QUEUE, AI_RECOVERY_JOB, AI_RECOVERY_SCHEDULER } from './ai-queue.constants';

export interface RecoverPendingJobData {
  trigger: 'scheduled';
}

/**
 * API-process side scheduler-producer only, exactly mirroring MailImapQueueService (Slice C). The
 * periodic recovery scan (§11) is registered unconditionally and idempotently — AiClassificationService
 * itself is the actual AI_ENABLED gate, so a disabled environment just runs a cheap no-op scan every
 * 5 minutes rather than needing a second "is this even wired up" toggle.
 *
 * Deliberately NO global-concurrency guard here (unlike Slice C's IMAP queue): each classification
 * job targets an independent EmailMessage, and EmailMessage.classificationStatus=PENDING already
 * provides full correctness under any level of concurrency (§13) — there is no shared mutable
 * cursor to protect, so restricting cross-worker parallelism here would only cost throughput for no
 * safety benefit. Per-job stable jobId (`ai-classify:<emailMessageId>`, see
 * ai-classification-enqueue.service.ts) is what prevents duplicate ENQUEUES; the DB transaction CAS
 * is what prevents duplicate PERSISTENCE even if two jobs somehow both ran.
 */
@Injectable()
export class AiQueueService implements OnModuleInit {
  constructor(@InjectQueue(AI_QUEUE) private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(
      AI_RECOVERY_SCHEDULER,
      { every: AI_RECOVERY_SCAN_INTERVAL_MS },
      { name: AI_RECOVERY_JOB, data: { trigger: 'scheduled' } },
    );
  }
}
