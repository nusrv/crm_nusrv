import { ConfigService } from '@nestjs/config';
import { mailWorkersPaused, pausedOutboundBatch } from '../mail/mail-worker-maintenance';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { OperatorReplyOutboundService } from './operator-reply-outbound.service';
import { OPERATOR_REPLY_QUEUE, OPERATOR_REPLY_SEND_JOB } from './operator-reply-queue.constants';
import type { OperatorReplySendJobData } from './operator-reply-queue.service';

@Processor(OPERATOR_REPLY_QUEUE, { concurrency: 2 })
export class OperatorReplyWorker extends WorkerHost {
  constructor(private readonly outbound: OperatorReplyOutboundService, private readonly config: ConfigService = new ConfigService()) {
    super();
  }

  async process(job: Job<OperatorReplySendJobData>) {
    if (job.name !== OPERATOR_REPLY_SEND_JOB) {
      throw new Error(`Unsupported operator-reply job: ${job.name}.`);
    }
    if (mailWorkersPaused(this.config.get<string>('MAIL_WORKERS_PAUSED'))) return pausedOutboundBatch();
    return this.outbound.processBatch();
  }
}
