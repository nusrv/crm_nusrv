import { Processor, WorkerHost } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import type { Job } from 'bullmq';
import { PrismaService } from '../../database/prisma.service';
import { ClassificationStatus, MessageDirection } from '../../generated/prisma/enums';
import { AiClassificationEnqueueService } from './ai-classification-enqueue.service';
import type { ClassifyMessageJobData } from './ai-classification-enqueue.service';
import { AiClassificationService } from './ai-classification.service';
import { AI_RECOVERY_SCAN_BATCH_SIZE } from './ai-timing.constants';
import { AI_CLASSIFY_JOB, AI_QUEUE, AI_RECOVERY_JOB } from './ai-queue.constants';
import type { RecoverPendingJobData } from './ai-queue.service';

type AiJobData = ClassifyMessageJobData | RecoverPendingJobData;

/**
 * Slice D §11 — the dedicated AI-classification worker; the only place either job type actually
 * runs. `concurrency: 2` bounds how many classification calls this one process makes in parallel
 * (real network calls to the configured provider) — see ai-queue.service.ts's doc comment for why
 * no cross-process global concurrency guard is needed here.
 */
@Processor(AI_QUEUE, { concurrency: 2 })
export class AiClassificationWorker extends WorkerHost {
  constructor(
    private readonly classification: AiClassificationService,
    private readonly enqueue: AiClassificationEnqueueService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    super();
  }

  async process(job: Job<AiJobData>) {
    if (job.name === AI_CLASSIFY_JOB) {
      const data = job.data as ClassifyMessageJobData;
      const isLastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      return this.classification.classifyMessage(data.emailMessageId, isLastAttempt);
    }
    if (job.name === AI_RECOVERY_JOB) {
      return this.runRecoveryScan();
    }
    throw new Error(`Unsupported AI job: ${job.name}.`);
  }

  /** §11/§30 / hardening-pass §2 — bounded scan (never an unbounded table scan) for eligible
   * PENDING inbound messages, re-enqueuing each via the same BullMQ-deduplicated enqueue path. A
   * message already queued/active simply dedupes at the queue layer; this exists to recover a
   * message whose opportunistic post-ingest enqueue was lost to a transient Redis outage, AND to
   * pick up historical PENDING mail that accumulated while AI_ENABLED=false, the moment the
   * application is reconfigured with AI_ENABLED=true — no separate backfill step is needed.
   *
   * When AI_ENABLED=false, this is a true no-op: not merely "the query runs but enqueue no-ops",
   * but skipped before any DB read at all, so a disabled AI provider never even causes a bounded
   * PENDING scan to run on a schedule for nothing. */
  private async runRecoveryScan(): Promise<{ scanned: number }> {
    if (this.config.get<string>('AI_ENABLED') !== 'true') {
      return { scanned: 0 };
    }
    const eligible = await this.prisma.emailMessage.findMany({
      where: { direction: MessageDirection.INBOUND, classificationStatus: ClassificationStatus.PENDING },
      orderBy: { occurredAt: 'asc' },
      take: AI_RECOVERY_SCAN_BATCH_SIZE,
      select: { id: true },
    });
    for (const row of eligible) {
      await this.enqueue.enqueueIfEnabled(row.id);
    }
    return { scanned: eligible.length };
  }
}
