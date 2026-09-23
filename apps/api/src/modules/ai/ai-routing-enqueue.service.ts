import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { AI_QUEUE, AI_ROUTE_JOB } from './ai-queue.constants';

export interface RouteClassificationJobData {
  routingDecisionId: string;
}

/** Deliberately hyphen-, not colon-, delimited — see classifyDeduplicationId's own doc comment for
 * why (a custom BullMQ identifier must never contain ':'). */
export function routeDeduplicationId(routingDecisionId: string): string {
  return `ai-route-${routingDecisionId}`;
}

/**
 * Slice G §8 — mirrors AiClassificationEnqueueService exactly (same Simple Deduplication rationale,
 * same "enqueue failure must never roll back the already-committed row" rationale). Injected into
 * AiClassificationService so it can opportunistically enqueue a newly-created PENDING
 * AiRoutingDecision AFTER its own transaction has already committed (§5) — never before, never as
 * part of that transaction.
 *
 * The DB-level PENDING/PROCESSING claim in AiRoutingService remains the sole correctness boundary —
 * this queue-level dedup is purely a throughput optimization, never relied upon for correctness. A
 * lost enqueue (Redis unavailable, etc.) is recovered by the periodic routing recovery scan, which
 * scans ONLY AiRoutingDecision rows, never AiClassification (§7/§J of the frozen pre-flight
 * decisions — historical classifications must never be discovered and auto-routed this way).
 */
@Injectable()
export class AiRoutingEnqueueService {
  constructor(@InjectQueue(AI_QUEUE) private readonly queue: Queue<RouteClassificationJobData>) {}

  async enqueue(routingDecisionId: string): Promise<void> {
    try {
      await this.queue.add(
        AI_ROUTE_JOB,
        { routingDecisionId },
        { deduplication: { id: routeDeduplicationId(routingDecisionId) } },
      );
    } catch {
      // Swallowed by design — see class doc comment.
    }
  }
}
