import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { RenewalEngineService } from './renewal-engine.service';
import { RENEWAL_EVALUATION_JOB, RENEWAL_QUEUE } from './renewal-queue.constants';
import type { RenewalEvaluationJobData } from './renewal-queue.service';

@Processor(RENEWAL_QUEUE, { concurrency: 2 })
export class RenewalWorker extends WorkerHost {
  constructor(private readonly engine: RenewalEngineService) {
    super();
  }

  async process(job: Job<RenewalEvaluationJobData>) {
    if (job.name !== RENEWAL_EVALUATION_JOB) {
      throw new Error(`Unsupported renewal job: ${job.name}.`);
    }
    return this.engine.evaluateAll({
      trigger: job.data.trigger,
      actorId: job.data.actorId,
      ipAddress: job.data.ipAddress,
    });
  }
}
