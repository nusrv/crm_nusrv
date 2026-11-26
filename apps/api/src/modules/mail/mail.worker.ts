import { ConfigService } from '@nestjs/config';
import { mailWorkersPaused, pausedOutboundBatch } from './mail-worker-maintenance';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { MailOutboundService } from './mail-outbound.service';
import { MAIL_QUEUE, MAIL_SEND_JOB } from './mail-queue.constants';
import type { MailSendJobData } from './mail-queue.service';

@Processor(MAIL_QUEUE, { concurrency: 2 })
export class MailWorker extends WorkerHost {
  constructor(private readonly outbound: MailOutboundService, private readonly config: ConfigService = new ConfigService()) {
    super();
  }

  async process(job: Job<MailSendJobData>) {
    if (job.name !== MAIL_SEND_JOB) {
      throw new Error(`Unsupported mail job: ${job.name}.`);
    }
    if (mailWorkersPaused(this.config.get<string>('MAIL_WORKERS_PAUSED'))) return pausedOutboundBatch();
    return this.outbound.processBatch();
  }
}
