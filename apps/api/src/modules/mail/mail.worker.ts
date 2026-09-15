import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { MailOutboundService } from './mail-outbound.service';
import { MAIL_QUEUE, MAIL_SEND_JOB } from './mail-queue.constants';
import type { MailSendJobData } from './mail-queue.service';

@Processor(MAIL_QUEUE, { concurrency: 2 })
export class MailWorker extends WorkerHost {
  constructor(private readonly outbound: MailOutboundService) {
    super();
  }

  async process(job: Job<MailSendJobData>) {
    if (job.name !== MAIL_SEND_JOB) {
      throw new Error(`Unsupported mail job: ${job.name}.`);
    }
    return this.outbound.processBatch();
  }
}
