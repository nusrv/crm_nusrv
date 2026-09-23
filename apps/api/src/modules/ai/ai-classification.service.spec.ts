import { jest } from '@jest/globals';
import { AiIntent, ClassificationStatus, HealthStatus, MessageDirection } from '../../generated/prisma/enums';
import { AiClassificationService } from './ai-classification.service';
import { AI_AUDIT_EVENT } from './ai-events.constants';
import { RESULT_SCHEMA_VERSION } from './llm-gateway';
import { LlmMalformedOutputError, LlmPermanentError, LlmTransientError } from './llm-errors';

interface FakeMessageRow {
  id: string;
  threadId: string;
  subject: string;
  bodyText: string;
  occurredAt: Date;
  /** Optional — defaults to occurredAt when omitted (existing test literals never set this
   * explicitly; only the dedicated cutover-hardening tests below override it). */
  createdAt?: Date;
  /** Optional — defaults to null (no linked case) when omitted. */
  renewalCaseId?: string | null;
  direction: MessageDirection;
  classificationStatus: ClassificationStatus | null;
}

function fakePrisma(messages: FakeMessageRow[]) {
  const rows = new Map(messages.map((m) => [m.id, { createdAt: m.occurredAt, renewalCaseId: null, ...m }]));
  const classifications: Record<string, unknown>[] = [];

  const findUnique = jest.fn(({ where }: { where: { id: string } }) => {
    const row = rows.get(where.id);
    return Promise.resolve(row ? { ...row } : null);
  });

  const findMany = jest.fn(
    ({ where, take }: { where: { threadId: string; id: { not: string }; occurredAt: { lt: Date } }; take: number }) => {
      const matching = [...rows.values()]
        .filter((r) => r.threadId === where.threadId && r.id !== where.id.not && r.occurredAt < where.occurredAt.lt)
        .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
        .slice(0, take);
      return Promise.resolve(matching);
    },
  );

  function updateManyImpl(args: { where: Record<string, unknown>; data: Record<string, unknown> }) {
    const row = rows.get(args.where.id as string);
    if (!row) return { count: 0 };
    for (const [key, value] of Object.entries(args.where)) {
      if (key === 'id') continue;
      if ((row as Record<string, unknown>)[key] !== value) return { count: 0 };
    }
    Object.assign(row, args.data);
    return { count: 1 };
  }
  const updateMany = jest.fn((args: { where: Record<string, unknown>; data: Record<string, unknown> }) =>
    Promise.resolve(updateManyImpl(args)),
  );

  const aiClassificationCreate = jest.fn((args: { data: Record<string, unknown> }) => {
    const created = { id: `clf-${classifications.length + 1}`, createdAt: new Date(), ...args.data };
    classifications.push(created);
    return Promise.resolve(created);
  });

  const routingDecisions: Record<string, unknown>[] = [];
  const aiRoutingDecisionCreate = jest.fn((args: { data: Record<string, unknown> }) => {
    const created = { id: `route-${routingDecisions.length + 1}`, createdAt: new Date(), updatedAt: new Date(), ...args.data };
    routingDecisions.push(created);
    return Promise.resolve(created);
  });

  const tx = {
    emailMessage: { updateMany },
    aiClassification: { create: aiClassificationCreate },
    aiRoutingDecision: { create: aiRoutingDecisionCreate },
  };
  const $transaction = jest.fn((cb: (tx: unknown) => unknown) => Promise.resolve(cb(tx)));

  const prisma = { emailMessage: { findUnique, findMany, updateMany }, $transaction };
  return { prisma, rows, classifications, routingDecisions, findUnique, findMany, updateMany, aiClassificationCreate, aiRoutingDecisionCreate };
}

function harness(options: {
  messages: FakeMessageRow[];
  configValues?: Record<string, string>;
  classifyIntentImpl: (input: unknown) => Promise<unknown>;
}) {
  const { prisma, rows, classifications, routingDecisions, findUnique, findMany, updateMany, aiClassificationCreate, aiRoutingDecisionCreate } =
    fakePrisma(options.messages);
  const config = {
    get: (key: string) => {
      const values: Record<string, unknown> = {
        AI_ENABLED: 'true',
        AI_PROVIDER: 'mock',
        AI_CONFIDENCE_THRESHOLD: 0.9,
        ...options.configValues,
      };
      return values[key];
    },
  };
  const auditRecord = jest.fn((event: { eventKey: string; metadata?: Record<string, unknown> }) => {
    void event;
    return Promise.resolve();
  });
  const audit = { record: auditRecord };
  const healthRecord = jest.fn((status: HealthStatus, message: string) => {
    void status;
    void message;
    return Promise.resolve();
  });
  const health = { record: healthRecord };
  const clock = { now: () => new Date('2026-01-15T00:00:00.000Z') };
  const routingEnqueueFn = jest.fn(() => Promise.resolve());
  const routingEnqueue = { enqueue: routingEnqueueFn };
  const gateway = { classifyIntent: jest.fn(options.classifyIntentImpl) };

  const service = new AiClassificationService(
    prisma as never,
    config as never,
    audit as never,
    health as never,
    clock,
    routingEnqueue as never,
    gateway as never,
  );

  return {
    service,
    rows,
    classifications,
    routingDecisions,
    findUnique,
    findMany,
    updateMany,
    aiClassificationCreate,
    aiRoutingDecisionCreate,
    auditRecord,
    healthRecord,
    gateway,
    routingEnqueueFn,
  };
}

const baseMessage: FakeMessageRow = {
  id: 'msg-1',
  threadId: 'thread-1',
  subject: 'Renewal',
  bodyText: 'yes please renew',
  occurredAt: new Date('2026-01-05T00:00:00Z'),
  direction: MessageDirection.INBOUND,
  classificationStatus: ClassificationStatus.PENDING,
};

function validResult(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: RESULT_SCHEMA_VERSION,
    intent: AiIntent.ACCEPT_RENEWAL,
    confidence: 0.95,
    requiresHumanReview: false,
    summary: 'ok',
    language: 'en',
    ...overrides,
  };
}

describe('AiClassificationService', () => {
  it('§10 — AI_ENABLED=false: no provider call, no DB read, no status change', async () => {
    const { service, gateway, findUnique } = harness({
      messages: [baseMessage],
      configValues: { AI_ENABLED: 'false' },
      classifyIntentImpl: () => Promise.resolve(validResult()),
    });

    const outcome = await service.classifyMessage('msg-1', false);

    expect(outcome).toBe('skipped_disabled');
    expect(findUnique).not.toHaveBeenCalled();
    expect(gateway.classifyIntent).not.toHaveBeenCalled();
  });

  it('§9 — a message that does not exist is skipped, never an error', async () => {
    const { service, gateway } = harness({ messages: [], classifyIntentImpl: () => Promise.resolve(validResult()) });
    const outcome = await service.classifyMessage('nonexistent', false);
    expect(outcome).toBe('skipped_ineligible');
    expect(gateway.classifyIntent).not.toHaveBeenCalled();
  });

  it('§9/§33J — an OUTBOUND message is never automatically classified', async () => {
    const { service, gateway, rows } = harness({
      messages: [{ ...baseMessage, direction: MessageDirection.OUTBOUND }],
      classifyIntentImpl: () => Promise.resolve(validResult()),
    });

    const outcome = await service.classifyMessage('msg-1', false);

    expect(outcome).toBe('skipped_ineligible');
    expect(gateway.classifyIntent).not.toHaveBeenCalled();
    expect(rows.get('msg-1')!.classificationStatus).toBe(ClassificationStatus.PENDING);
  });

  it('§9/§33K — a Slice-C HUMAN_REVIEW inbound message is never overwritten by automatic classification', async () => {
    const { service, gateway, rows } = harness({
      messages: [{ ...baseMessage, classificationStatus: ClassificationStatus.HUMAN_REVIEW }],
      classifyIntentImpl: () => Promise.resolve(validResult()),
    });

    const outcome = await service.classifyMessage('msg-1', false);

    expect(outcome).toBe('skipped_ineligible');
    expect(gateway.classifyIntent).not.toHaveBeenCalled();
    expect(rows.get('msg-1')!.classificationStatus).toBe(ClassificationStatus.HUMAN_REVIEW);
  });

  it.each(['CLASSIFIED', 'RESOLVED', 'FAILED'] as const)('§9 — a message already %s is never re-classified', async (status) => {
    const { service, gateway } = harness({
      messages: [{ ...baseMessage, classificationStatus: status }],
      classifyIntentImpl: () => Promise.resolve(validResult()),
    });
    const outcome = await service.classifyMessage('msg-1', false);
    expect(outcome).toBe('skipped_ineligible');
    expect(gateway.classifyIntent).not.toHaveBeenCalled();
  });

  it('§35 — high confidence -> CLASSIFIED, AiClassification persisted with correct fields', async () => {
    const { service, rows, classifications, healthRecord, auditRecord } = harness({
      messages: [baseMessage],
      classifyIntentImpl: () => Promise.resolve(validResult({ confidence: 0.96 })),
    });

    const outcome = await service.classifyMessage('msg-1', false);

    expect(outcome).toBe('classified');
    expect(rows.get('msg-1')!.classificationStatus).toBe(ClassificationStatus.CLASSIFIED);
    expect(classifications).toHaveLength(1);
    expect(classifications[0]).toMatchObject({
      emailMessageId: 'msg-1',
      provider: 'mock',
      model: 'mock',
      promptVersion: 'phase3-intent-v1',
      intent: AiIntent.ACCEPT_RENEWAL,
      requiresHumanReview: false,
    });
    expect(healthRecord).toHaveBeenCalledWith(HealthStatus.HEALTHY, expect.any(String));
    const createdAuditCall = auditRecord.mock.calls.find((call) => call[0].eventKey === AI_AUDIT_EVENT.CLASSIFICATION_CREATED);
    expect(createdAuditCall).toBeDefined();
  });

  it('§35 — valid intent at 0.89 (below default 0.90 threshold) -> HUMAN_REVIEW', async () => {
    const { service, rows, auditRecord } = harness({
      messages: [baseMessage],
      classifyIntentImpl: () => Promise.resolve(validResult({ confidence: 0.89 })),
    });

    const outcome = await service.classifyMessage('msg-1', false);

    expect(outcome).toBe('human_review');
    expect(rows.get('msg-1')!.classificationStatus).toBe(ClassificationStatus.HUMAN_REVIEW);
    const reviewAuditCall = auditRecord.mock.calls.find((call) => call[0].eventKey === AI_AUDIT_EVENT.HUMAN_REVIEW_REQUIRED);
    expect(reviewAuditCall).toBeDefined();
  });

  it('confidence exactly at the threshold boundary (0.90) is NOT below it -> CLASSIFIED', async () => {
    const { service, rows } = harness({
      messages: [baseMessage],
      classifyIntentImpl: () => Promise.resolve(validResult({ confidence: 0.9 })),
    });
    await service.classifyMessage('msg-1', false);
    expect(rows.get('msg-1')!.classificationStatus).toBe(ClassificationStatus.CLASSIFIED);
  });

  it('§35 — requiresHumanReview=true at high confidence -> HUMAN_REVIEW', async () => {
    const { service, rows } = harness({
      messages: [baseMessage],
      classifyIntentImpl: () => Promise.resolve(validResult({ confidence: 0.99, requiresHumanReview: true })),
    });
    await service.classifyMessage('msg-1', false);
    expect(rows.get('msg-1')!.classificationStatus).toBe(ClassificationStatus.HUMAN_REVIEW);
  });

  it('§35 — UNCLEAR at 0.99 confidence -> HUMAN_REVIEW regardless of confidence', async () => {
    const { service, rows } = harness({
      messages: [baseMessage],
      classifyIntentImpl: () => Promise.resolve(validResult({ intent: AiIntent.UNCLEAR, confidence: 0.99 })),
    });
    await service.classifyMessage('msg-1', false);
    expect(rows.get('msg-1')!.classificationStatus).toBe(ClassificationStatus.HUMAN_REVIEW);
  });

  it('§12A — transient failure, not last attempt: rethrows, stays PENDING, DEGRADED health, no HUMAN_REVIEW transition', async () => {
    const { service, rows, healthRecord, auditRecord } = harness({
      messages: [baseMessage],
      classifyIntentImpl: () => Promise.reject(new LlmTransientError('timeout')),
    });

    await expect(service.classifyMessage('msg-1', false)).rejects.toBeInstanceOf(LlmTransientError);

    expect(rows.get('msg-1')!.classificationStatus).toBe(ClassificationStatus.PENDING);
    expect(healthRecord).toHaveBeenCalledWith(HealthStatus.DEGRADED, expect.any(String));
    expect(auditRecord).not.toHaveBeenCalledWith(expect.objectContaining({ eventKey: AI_AUDIT_EVENT.CLASSIFICATION_FAILED }));
  });

  it('§12D — transient failure, retry budget exhausted (isLastAttempt): HUMAN_REVIEW, CLASSIFICATION_FAILED audit', async () => {
    const { service, rows, healthRecord, auditRecord } = harness({
      messages: [baseMessage],
      classifyIntentImpl: () => Promise.reject(new LlmTransientError('timeout')),
    });

    const outcome = await service.classifyMessage('msg-1', true);

    expect(outcome).toBe('failed_human_review');
    expect(rows.get('msg-1')!.classificationStatus).toBe(ClassificationStatus.HUMAN_REVIEW);
    expect(healthRecord).toHaveBeenCalledWith(HealthStatus.DEGRADED, expect.any(String));
    const failedCall = auditRecord.mock.calls.find((call) => call[0].eventKey === AI_AUDIT_EVENT.CLASSIFICATION_FAILED);
    expect(failedCall?.[0].metadata).toMatchObject({ reason: 'RETRY_BUDGET_EXHAUSTED' });
  });

  it('§12B — permanent failure ends in HUMAN_REVIEW immediately, even on the first attempt (no pointless retry)', async () => {
    const { service, rows, healthRecord, auditRecord } = harness({
      messages: [baseMessage],
      classifyIntentImpl: () => Promise.reject(new LlmPermanentError('invalid api key')),
    });

    const outcome = await service.classifyMessage('msg-1', false);

    expect(outcome).toBe('failed_human_review');
    expect(rows.get('msg-1')!.classificationStatus).toBe(ClassificationStatus.HUMAN_REVIEW);
    expect(healthRecord).toHaveBeenCalledWith(HealthStatus.UNAVAILABLE, expect.any(String));
    const failedCall = auditRecord.mock.calls[0]!;
    expect(failedCall[0].metadata).toMatchObject({ reason: 'PROVIDER_PERMANENT_ERROR' });
  });

  it('§12C/§16/§37 — malformed output ends in HUMAN_REVIEW with NO health event at all', async () => {
    const { service, rows, healthRecord } = harness({
      messages: [baseMessage],
      classifyIntentImpl: () => Promise.reject(new LlmMalformedOutputError('bad json')),
    });

    const outcome = await service.classifyMessage('msg-1', false);

    expect(outcome).toBe('failed_human_review');
    expect(rows.get('msg-1')!.classificationStatus).toBe(ClassificationStatus.HUMAN_REVIEW);
    expect(healthRecord).not.toHaveBeenCalled(); // one bad message never implies the provider is down.
  });

  it('§13/§28A/§28B — a lost CAS never persists an AiClassification (no orphan row)', async () => {
    const { service, classifications, updateMany } = harness({
      messages: [baseMessage],
      classifyIntentImpl: () => Promise.resolve(validResult()),
    });
    // Force the persistence CAS to lose, simulating another worker having already claimed it.
    updateMany.mockImplementationOnce(() => Promise.resolve({ count: 0 }));

    const outcome = await service.classifyMessage('msg-1', false);

    expect(outcome).toBe('lost_cas');
    expect(classifications).toHaveLength(0);
  });

  it('§8 — loads at most MAX_HISTORY_MESSAGES prior messages, chronologically ordered, excluding the current one', async () => {
    const history = Array.from({ length: 6 }, (_, i) => ({
      ...baseMessage,
      id: `hist-${i}`,
      occurredAt: new Date(2026, 0, i + 1),
    }));
    const { service, findMany, gateway } = harness({
      messages: [...history, { ...baseMessage, id: 'msg-1', occurredAt: new Date('2026-02-01') }],
      classifyIntentImpl: () => Promise.resolve(validResult()),
    });

    await service.classifyMessage('msg-1', false);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 4 }),
    );
    const passedInput = gateway.classifyIntent.mock.calls[0]![0] as { priorMessages: unknown[] };
    expect(passedInput.priorMessages).toHaveLength(4);
  });

  describe('contract-audit hardening §1 — cutover must also protect historical PENDING mail', () => {
    const CUTOVER = '2026-01-15T00:00:00.000Z';
    const configValues = {
      AI_AUTO_ROUTE_ACCEPT: 'true',
      AI_AUTO_ROUTE_ACCEPT_CUTOVER_AT: CUTOVER,
    };

    it('a historical message (createdAt/occurredAt BEFORE cutover) classified AFTER cutover never gets AUTO_ACCEPT, even with a valid ACCEPT_RENEWAL classification', async () => {
      const historicalMessage = {
        ...baseMessage,
        occurredAt: new Date('2026-01-10T00:00:00.000Z'),
        createdAt: new Date('2026-01-10T00:00:00.000Z'),
        renewalCaseId: 'case-1',
      };
      const { service, routingDecisions } = harness({
        messages: [historicalMessage],
        configValues,
        classifyIntentImpl: () => Promise.resolve(validResult()),
      });

      await service.classifyMessage('msg-1', false);

      expect(routingDecisions).toHaveLength(1);
      expect(routingDecisions[0]!.action).toBe('HUMAN_REVIEW');
    });

    it('a message ingested and occurring AFTER cutover, classified AFTER cutover, with a linked case: AUTO_ACCEPT', async () => {
      const freshMessage = {
        ...baseMessage,
        occurredAt: new Date('2026-01-20T00:00:00.000Z'),
        createdAt: new Date('2026-01-20T00:00:00.000Z'),
        renewalCaseId: 'case-1',
      };
      const { service, routingDecisions } = harness({
        messages: [freshMessage],
        configValues,
        classifyIntentImpl: () => Promise.resolve(validResult()),
      });

      await service.classifyMessage('msg-1', false);

      expect(routingDecisions).toHaveLength(1);
      expect(routingDecisions[0]!.action).toBe('AUTO_ACCEPT');
    });
  });
});
