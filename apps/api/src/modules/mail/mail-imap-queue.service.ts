import { Injectable, type OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { IMAP_QUEUE, IMAP_SYNC_INTERVAL_MS, IMAP_SYNC_JOB, IMAP_SYNC_SCHEDULER } from './mail-imap-queue.constants';

export interface ImapSyncJobData {
  trigger: 'scheduled';
}

/**
 * API-process side scheduler-producer only, exactly mirroring MailQueueService (Slice B). The
 * schedule is registered unconditionally and idempotently (`upsertJobScheduler`) — MailInboundIngestService.syncAll()
 * itself is the actual IMAP_SYNC_ENABLED gate, so a disabled environment just runs a cheap no-op
 * every 5 minutes rather than needing a second "is this even wired up" toggle.
 *
 * DISTRIBUTED OVERLAP GUARD (correction pass §4): `setGlobalConcurrency(1)` is a real, Redis-backed
 * limit enforced by BullMQ itself across every Worker process consuming this queue (installed
 * bullmq@5.81.3 — confirmed via its own `Queue.setGlobalConcurrency` API) — NOT a local
 * `Worker({concurrency:1})` setting, which only bounds one process's own parallelism and provides
 * no guarantee at all once more than one worker process/instance exists. This queue (`mail-inbound`)
 * is registered separately from the outbound SMTP queue (`mail-outbound`), so this limit only ever
 * throttles IMAP sync jobs, never outbound mail sending. Idempotent to call on every boot — it is a
 * persisted Redis value, not a one-time registration.
 */
@Injectable()
export class MailImapQueueService implements OnModuleInit {
  constructor(@InjectQueue(IMAP_QUEUE) private readonly queue: Queue<ImapSyncJobData>) {}

  async onModuleInit(): Promise<void> {
    await this.queue.setGlobalConcurrency(1);
    await this.queue.upsertJobScheduler(
      IMAP_SYNC_SCHEDULER,
      { every: IMAP_SYNC_INTERVAL_MS },
      { name: IMAP_SYNC_JOB, data: { trigger: 'scheduled' } },
    );
  }
}
