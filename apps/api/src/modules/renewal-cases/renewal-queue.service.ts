import { randomUUID } from 'node:crypto';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { AuditService } from '../../audit/audit.service';
import type { MutationContext } from '../../common/mutation-context';
import { ActorType } from '../../generated/prisma/enums';
import { BusinessTimeService } from '../../time/business-time.service';
import {
  DAILY_RENEWAL_SCHEDULER,
  RENEWAL_EVALUATION_JOB,
  RENEWAL_QUEUE,
} from './renewal-queue.constants';

export interface RenewalEvaluationJobData {
  trigger: 'scheduled' | 'manual';
  actorId?: string;
  ipAddress?: string;
  reason?: string;
}

@Injectable()
export class RenewalQueueService implements OnModuleInit {
  constructor(
    @InjectQueue(RENEWAL_QUEUE) private readonly queue: Queue<RenewalEvaluationJobData>,
    private readonly businessTime: BusinessTimeService,
    private readonly audit: AuditService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(
      DAILY_RENEWAL_SCHEDULER,
      { pattern: '0 5 0 * * *', tz: this.businessTime.timezone },
      { name: RENEWAL_EVALUATION_JOB, data: { trigger: 'scheduled' } },
    );
  }

  async triggerManual(reason: string | undefined, context: MutationContext) {
    const requestId = randomUUID();
    const auditEvent = await this.audit.record({
      actorType: ActorType.USER,
      actorId: context.actorId,
      eventKey: 'renewal.engine.manual_execution.requested',
      subjectType: 'RenewalEngineExecution',
      subjectId: requestId,
      metadata: { reason: reason?.trim() || null },
      ipAddress: context.ipAddress,
    });
    const job = await this.queue.add(
      RENEWAL_EVALUATION_JOB,
      {
        trigger: 'manual',
        actorId: context.actorId,
        ipAddress: context.ipAddress,
        reason: reason?.trim(),
      },
      { jobId: `manual-${requestId}` },
    );
    return { requestId, jobId: job.id, auditEventId: auditEvent.id, status: 'QUEUED' as const };
  }
}
