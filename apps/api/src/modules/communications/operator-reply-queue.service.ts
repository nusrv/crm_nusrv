import { Injectable, type OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import {
  OPERATOR_REPLY_QUEUE,
  OPERATOR_REPLY_SCAN_INTERVAL_MS,
  OPERATOR_REPLY_SEND_JOB,
  OPERATOR_REPLY_SEND_SCHEDULER,
} from './operator-reply-queue.constants';

export interface OperatorReplySendJobData {
  trigger: 'scheduled';
}

/**
 * Reuses the project's established BullMQ repeatable-job pattern (see MailQueueService/
 * RenewalQueueService) rather than inventing a second scheduling framework. Registered
 * unconditionally — OperatorReplyOutboundService.processBatch() itself is the actual
 * MAIL_SEND_ENABLED/cutover gate (§14), so a disabled environment simply runs a cheap no-op batch
 * every cycle.
 */
@Injectable()
export class OperatorReplyQueueService implements OnModuleInit {
  constructor(@InjectQueue(OPERATOR_REPLY_QUEUE) private readonly queue: Queue<OperatorReplySendJobData>) {}

  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(
      OPERATOR_REPLY_SEND_SCHEDULER,
      { every: OPERATOR_REPLY_SCAN_INTERVAL_MS },
      { name: OPERATOR_REPLY_SEND_JOB, data: { trigger: 'scheduled' } },
    );
  }
}
