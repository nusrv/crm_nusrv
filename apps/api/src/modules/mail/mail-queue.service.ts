import { Injectable, type OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { MAIL_SEND_JOB, MAIL_SEND_SCHEDULER, MAIL_QUEUE } from './mail-queue.constants';

export interface MailSendJobData {
  trigger: 'scheduled';
}

/**
 * Reuses the project's existing BullMQ repeatable-job pattern (see RenewalQueueService) rather
 * than inventing a second scheduling framework. Registers the periodic scheduler unconditionally
 * — MailOutboundService.processBatch() itself is the actual MAIL_SEND_ENABLED gate (§21), so a
 * disabled environment simply runs a very cheap no-op every cycle rather than needing a second,
 * separate "is this even wired up" toggle.
 */
@Injectable()
export class MailQueueService implements OnModuleInit {
  constructor(@InjectQueue(MAIL_QUEUE) private readonly queue: Queue<MailSendJobData>) {}

  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(
      MAIL_SEND_SCHEDULER,
      { every: 60_000 },
      { name: MAIL_SEND_JOB, data: { trigger: 'scheduled' } },
    );
  }
}
