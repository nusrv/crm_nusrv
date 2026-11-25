import { ConfigService } from '@nestjs/config';
import { mailWorkersPaused, pausedInboundBatch } from './mail-worker-maintenance';
import { Logger } from '@nestjs/common';
import { MailSentObservationService } from './mail-sent-observation.service';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { MailInboundIngestService } from './mail-inbound-ingest.service';
import { IMAP_QUEUE, IMAP_SYNC_JOB } from './mail-imap-queue.constants';
import type { ImapSyncJobData } from './mail-imap-queue.service';

/** concurrency: 1 — a single repeatable job loops over every enabled mailbox sequentially (see
 * MailInboundIngestService's doc comment); running two instances of this job concurrently would
 * let two loops race on the same MailConfiguration's cursor, which nothing else in this slice
 * guards against (§30's overlap-avoidance requirement is satisfied here, not via a per-message
 * lease/CAS). */
@Processor(IMAP_QUEUE, { concurrency: 1 })
export class MailImapWorker extends WorkerHost {
  constructor(private readonly ingest: MailInboundIngestService, private readonly sent: MailSentObservationService, private readonly config: ConfigService = new ConfigService()) {
    super();
  }

  async process(job: Job<ImapSyncJobData>) {
    if (job.name !== IMAP_SYNC_JOB) {
      throw new Error(`Unsupported IMAP job: ${job.name}.`);
    }
    if (mailWorkersPaused(this.config.get<string>('MAIL_WORKERS_PAUSED'))) return pausedInboundBatch();
    const result = await this.ingest.syncAll();
    await this.sent.syncEnabled().catch(() => new Logger(MailImapWorker.name).warn('Sent observation cycle failed.'));
    return result;
  }
}
