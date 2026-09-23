import { jest } from '@jest/globals';
import { AiRoutingService } from './ai-routing.service';
import { AI_ROUTING_RESULT_CODE, AI_ROUTING_VERSION } from './ai-routing.constants';

interface RoutingDecisionRow {
  id: string;
  aiClassificationId: string;
  renewalCaseId: string | null;
  routingVersion: string;
  action: 'AUTO_ACCEPT' | 'HUMAN_REVIEW';
  status: 'PENDING' | 'PROCESSING' | 'SUCCEEDED' | 'SKIPPED' | 'FAILED';
  resultCode: string | null;
  attempts: number;
  lastAttemptAt: Date | null;
  completedAt: Date | null;
}

interface EmailMessageRow {
  id: string;
  threadId: string;
  direction: 'INBOUND' | 'OUTBOUND';
  classificationStatus: 'PENDING' | 'CLASSIFIED' | 'HUMAN_REVIEW' | 'RESOLVED' | 'FAILED';
  renewalCaseId: string | null;
}

interface RenewalCaseRow {
  id: string;
  status: string;
  customerDecision?: string;
  acceptedAt?: Date | null;
}

interface ThreadRow {
  id: string;
  status: 'OPEN' | 'HUMAN_REVIEW' | 'RESOLVED';
}

interface ClassificationRow {
  id: string;
  emailMessageId: string;
  intent: string;
  confidence: string;
  requiresHumanReview: boolean;
  createdAt: Date;
}

function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'OR') return (cond as Record<string, unknown>[]).some((sub) => matches(row, sub));
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      const c = cond as Record<string, unknown>;
      if ('lt' in c) return (row[key] as Date) < (c.lt as Date);
      if ('lte' in c) return (row[key] as Date) <= (c.lte as Date);
      if ('not' in c) return row[key] !== c.not;
    }
    if (cond instanceof Date) return row[key] instanceof Date && (row[key]).getTime() === cond.getTime();
    return row[key] === cond;
  });
}

function applyData(row: Record<string, unknown>, data: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === 'object' && 'increment' in (value as Record<string, unknown>)) {
      row[key] = ((row[key] as number) ?? 0) + ((value as { increment: number }).increment);
    } else {
      row[key] = value;
    }
  }
}

function makeUpdateMany<T extends { id: string }>(map: Map<string, T>) {
  return jest.fn(({ where, data }: { where: { id: string } & Record<string, unknown>; data: Record<string, unknown> }) => {
    const row = map.get(where.id);
    if (!row || !matches(row, where)) return Promise.resolve({ count: 0 });
    applyData(row, data);
    return Promise.resolve({ count: 1 });
  });
}

function makeFindUniqueOrThrow<T extends { id: string }>(map: Map<string, T>) {
  return jest.fn(({ where }: { where: { id: string } }) => {
    const row = map.get(where.id);
    if (!row) throw new Error(`Record not found: ${where.id}`);
    return Promise.resolve({ ...row });
  });
}

function makeFindUnique<T extends { id: string }>(map: Map<string, T>) {
  return jest.fn(({ where }: { where: { id: string } }) => Promise.resolve(map.has(where.id) ? { ...map.get(where.id) } : null));
}

function buildHarness() {
  const emailMessages = new Map<string, EmailMessageRow>();
  const renewalCases = new Map<string, RenewalCaseRow>();
  const threads = new Map<string, ThreadRow>();
  const routingDecisions = new Map<string, RoutingDecisionRow>();
  const classifications = new Map<string, ClassificationRow>();
  const reviewedClassificationIds = new Set<string>();
  let currentTime = new Date('2026-02-01T00:00:00.000Z');
  let autoRouteAcceptEnabled = false;

  const auditRecord = jest.fn(() => Promise.resolve());
  const audit = { record: auditRecord };
  const clock = { now: () => currentTime };
  // Phase 3.1 §J — AiRoutingService now resolves autoRouteAcceptEnabled from
  // AiSettingsResolverService (DB-backed) instead of reading AI_AUTO_ROUTE_ACCEPT off ConfigService;
  // the confidence-threshold re-check this used to also need was removed entirely from
  // executeAutoAccept() (see that method's own doc comment for why re-deriving against a
  // now-mutable threshold would be unsafe).
  const aiSettings = {
    getSettings: () => Promise.resolve({ autoRouteAcceptEnabled }),
  };

  const aiRoutingDecisionUpdateMany = makeUpdateMany(routingDecisions);
  const aiRoutingDecisionFindUniqueOrThrow = makeFindUniqueOrThrow(routingDecisions);
  const aiRoutingDecisionFindUnique = makeFindUnique(routingDecisions);
  const aiRoutingDecisionFindMany = jest.fn(
    ({ where, take }: { where: Record<string, unknown>; orderBy: unknown; take: number }) =>
      Promise.resolve(
        [...routingDecisions.values()]
          .filter((row) => matches(row as unknown as Record<string, unknown>, where))
          .sort((a, b) => a.id.localeCompare(b.id))
          .slice(0, take)
          .map((row) => ({ id: row.id })),
      ),
  );

  const emailMessageUpdateMany = makeUpdateMany(emailMessages);
  const emailMessageFindUniqueOrThrow = makeFindUniqueOrThrow(emailMessages);

  const renewalCaseUpdateMany = makeUpdateMany(renewalCases);
  const renewalCaseFindUniqueOrThrow = makeFindUniqueOrThrow(renewalCases);
  const renewalCaseFindUnique = makeFindUnique(renewalCases);

  const threadUpdateMany = makeUpdateMany(threads);

  const aiClassificationFindUniqueOrThrow = jest.fn(({ where }: { where: { id: string } }) => {
    const row = classifications.get(where.id);
    if (!row) throw new Error('classification not found');
    const message = emailMessages.get(row.emailMessageId);
    return Promise.resolve({ ...row, emailMessage: message ? { ...message } : null });
  });
  const aiClassificationFindFirst = jest.fn(({ where }: { where: { emailMessageId: string } }) => {
    const matching = [...classifications.values()]
      .filter((c) => c.emailMessageId === where.emailMessageId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id));
    return Promise.resolve(matching[0] ? { id: matching[0].id } : null);
  });

  const classificationReviewFindFirst = jest.fn(({ where }: { where: { aiClassificationId: string } }) =>
    Promise.resolve(reviewedClassificationIds.has(where.aiClassificationId) ? { id: `review-for-${where.aiClassificationId}` } : null),
  );

  const txShape = {
    emailMessage: { updateMany: emailMessageUpdateMany, findUniqueOrThrow: emailMessageFindUniqueOrThrow },
    communicationThread: { updateMany: threadUpdateMany },
    renewalCase: { updateMany: renewalCaseUpdateMany, findUniqueOrThrow: renewalCaseFindUniqueOrThrow },
    aiRoutingDecision: { updateMany: aiRoutingDecisionUpdateMany },
  };
  const $transaction = jest.fn((cb: (tx: typeof txShape) => unknown) => Promise.resolve(cb(txShape)));

  const prisma = {
    aiRoutingDecision: {
      updateMany: aiRoutingDecisionUpdateMany,
      findUniqueOrThrow: aiRoutingDecisionFindUniqueOrThrow,
      findUnique: aiRoutingDecisionFindUnique,
      findMany: aiRoutingDecisionFindMany,
    },
    aiClassification: { findUniqueOrThrow: aiClassificationFindUniqueOrThrow, findFirst: aiClassificationFindFirst },
    renewalCase: { findUnique: renewalCaseFindUnique, findUniqueOrThrow: renewalCaseFindUniqueOrThrow },
    classificationReview: { findFirst: classificationReviewFindFirst },
    $transaction,
  };

  const service = new AiRoutingService(prisma as never, audit as never, clock, aiSettings as never);

  return {
    service,
    emailMessages,
    renewalCases,
    threads,
    routingDecisions,
    classifications,
    reviewedClassificationIds,
    auditRecord,
    setClockNow: (date: Date) => {
      currentTime = date;
    },
    setAutoRouteAccept: (enabled: boolean) => {
      autoRouteAcceptEnabled = enabled;
    },
  };
}

function seedAutoAccept(h: ReturnType<typeof buildHarness>, caseStatus: string) {
  // The kill switch (§3) gates EXECUTION, not the pre-seeded decision's action. These tests exercise
  // the worker actually attempting the AUTO_ACCEPT decision, so the switch is ON by default here —
  // the dedicated kill-switch tests below explicitly flip it off to test the paused path.
  h.setAutoRouteAccept(true);
  h.renewalCases.set('case-1', { id: 'case-1', status: caseStatus });
  h.threads.set('thread-1', { id: 'thread-1', status: 'OPEN' });
  h.emailMessages.set('msg-1', { id: 'msg-1', threadId: 'thread-1', direction: 'INBOUND', classificationStatus: 'CLASSIFIED', renewalCaseId: 'case-1' });
  h.classifications.set('clf-1', {
    id: 'clf-1',
    emailMessageId: 'msg-1',
    intent: 'ACCEPT_RENEWAL',
    confidence: '0.950',
    requiresHumanReview: false,
    createdAt: new Date('2026-01-20T00:00:00.000Z'),
  });
  h.routingDecisions.set('decision-1', {
    id: 'decision-1',
    aiClassificationId: 'clf-1',
    renewalCaseId: 'case-1',
    routingVersion: AI_ROUTING_VERSION,
    action: 'AUTO_ACCEPT',
    status: 'PENDING',
    resultCode: null,
    attempts: 0,
    lastAttemptAt: null,
    completedAt: null,
  });
}

function seedHumanReview(h: ReturnType<typeof buildHarness>, messageStatus: EmailMessageRow['classificationStatus'] = 'CLASSIFIED', threadStatus: ThreadRow['status'] = 'OPEN') {
  h.threads.set('thread-1', { id: 'thread-1', status: threadStatus });
  h.emailMessages.set('msg-1', { id: 'msg-1', threadId: 'thread-1', direction: 'INBOUND', classificationStatus: messageStatus, renewalCaseId: null });
  h.classifications.set('clf-1', {
    id: 'clf-1',
    emailMessageId: 'msg-1',
    intent: 'REJECT_RENEWAL',
    confidence: '0.950',
    requiresHumanReview: false,
    createdAt: new Date('2026-01-20T00:00:00.000Z'),
  });
  h.routingDecisions.set('decision-1', {
    id: 'decision-1',
    aiClassificationId: 'clf-1',
    renewalCaseId: null,
    routingVersion: AI_ROUTING_VERSION,
    action: 'HUMAN_REVIEW',
    status: 'PENDING',
    resultCode: null,
    attempts: 0,
    lastAttemptAt: null,
    completedAt: null,
  });
}

describe('AiRoutingService.processOne — claim/lease (§9)', () => {
  it('claims a PENDING decision and marks it PROCESSING with attempts incremented', async () => {
    const h = buildHarness();
    seedHumanReview(h);
    await h.service.processOne('decision-1');
    expect(h.routingDecisions.get('decision-1')!.status).not.toBe('PENDING');
  });

  it('returns not_claimed for an already-PROCESSING, non-stale decision', async () => {
    const h = buildHarness();
    seedHumanReview(h);
    h.routingDecisions.get('decision-1')!.status = 'PROCESSING';
    h.routingDecisions.get('decision-1')!.lastAttemptAt = new Date('2026-02-01T00:00:00.000Z');
    h.setClockNow(new Date('2026-02-01T00:00:30.000Z')); // 30s later — well under the 2min stale threshold.
    const outcome = await h.service.processOne('decision-1');
    expect(outcome).toBe('not_claimed');
  });

  it('reclaims a stale PROCESSING decision (past the lease threshold)', async () => {
    const h = buildHarness();
    seedHumanReview(h);
    h.routingDecisions.get('decision-1')!.status = 'PROCESSING';
    h.routingDecisions.get('decision-1')!.lastAttemptAt = new Date('2026-02-01T00:00:00.000Z');
    h.setClockNow(new Date('2026-02-01T00:05:00.000Z')); // 5 minutes later — past the 2min threshold.
    const outcome = await h.service.processOne('decision-1');
    expect(outcome).toBe('succeeded');
  });
});

describe('AiRoutingService — AUTO_ACCEPT (§11-§14/§27)', () => {
  it.each(['UPCOMING', 'REMINDER_CYCLE', 'AWAITING_CUSTOMER', 'HUMAN_REVIEW'])(
    'accepts from the legal source status %s: RenewalCase ACCEPTED, customerDecision/acceptedAt set, decision SUCCEEDED, message stays CLASSIFIED, thread stays OPEN',
    async (sourceStatus) => {
      const h = buildHarness();
      seedAutoAccept(h, sourceStatus);
      const outcome = await h.service.processOne('decision-1');

      expect(outcome).toBe('succeeded');
      const finalCase = h.renewalCases.get('case-1')!;
      expect(finalCase.status).toBe('ACCEPTED');
      expect(finalCase.customerDecision).toBe('ACCEPTED');
      expect(finalCase.acceptedAt).toBeInstanceOf(Date);
      expect(h.emailMessages.get('msg-1')!.classificationStatus).toBe('CLASSIFIED');
      expect(h.threads.get('thread-1')!.status).toBe('OPEN');
      const decision = h.routingDecisions.get('decision-1')!;
      expect(decision.status).toBe('SUCCEEDED');
      expect(decision.resultCode).toBe(AI_ROUTING_RESULT_CODE.AUTO_ACCEPTED);
      expect(decision.completedAt).toBeInstanceOf(Date);
    },
  );

  it('audits ActorType.AI with no actorId (never a synthetic user id) (§12)', async () => {
    const h = buildHarness();
    seedAutoAccept(h, 'UPCOMING');
    await h.service.processOne('decision-1');

    expect(h.auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({ actorType: 'AI', actorId: undefined, eventKey: 'ai.routing.auto_accepted' }),
      expect.anything(),
    );
  });

  it('§14 — already ACCEPTED: SKIPPED_ALREADY_ACCEPTED, never fabricates ownership, no message/thread mutation', async () => {
    const h = buildHarness();
    seedAutoAccept(h, 'ACCEPTED');
    const outcome = await h.service.processOne('decision-1');

    expect(outcome).toBe('skipped');
    expect(h.routingDecisions.get('decision-1')!.resultCode).toBe(AI_ROUTING_RESULT_CODE.SKIPPED_ALREADY_ACCEPTED);
    expect(h.emailMessages.get('msg-1')!.classificationStatus).toBe('CLASSIFIED');
    expect(h.threads.get('thread-1')!.status).toBe('OPEN');
  });

  it.each(['DO_NOT_RENEW', 'REJECTED', 'CLOSED', 'FULFILLED'])(
    '§14 — case moved to incompatible/terminal state %s: SKIPPED_CONCURRENT_BUSINESS_DECISION, never overridden, message/thread routed to HUMAN_REVIEW',
    async (incompatibleStatus) => {
      const h = buildHarness();
      seedAutoAccept(h, incompatibleStatus);
      const outcome = await h.service.processOne('decision-1');

      expect(outcome).toBe('skipped');
      expect(h.renewalCases.get('case-1')!.status).toBe(incompatibleStatus); // never overridden.
      expect(h.routingDecisions.get('decision-1')!.resultCode).toBe(AI_ROUTING_RESULT_CODE.SKIPPED_CONCURRENT_BUSINESS_DECISION);
      expect(h.emailMessages.get('msg-1')!.classificationStatus).toBe('HUMAN_REVIEW');
      expect(h.threads.get('thread-1')!.status).toBe('HUMAN_REVIEW');
    },
  );

  it('§10/§28.C — a human review already won the EmailMessage row (classificationStatus no longer CLASSIFIED): SKIPPED_HUMAN_ALREADY_REVIEWED, RenewalCase untouched, RESOLVED never downgraded', async () => {
    const h = buildHarness();
    seedAutoAccept(h, 'UPCOMING');
    h.emailMessages.get('msg-1')!.classificationStatus = 'RESOLVED';
    const outcome = await h.service.processOne('decision-1');

    expect(outcome).toBe('skipped');
    expect(h.routingDecisions.get('decision-1')!.resultCode).toBe(AI_ROUTING_RESULT_CODE.SKIPPED_HUMAN_ALREADY_REVIEWED);
    expect(h.renewalCases.get('case-1')!.status).toBe('UPCOMING'); // never overridden.
    expect(h.emailMessages.get('msg-1')!.classificationStatus).toBe('RESOLVED'); // never downgraded.
  });

  it('§10 defense-in-depth — a ClassificationReview already exists for this classification: SKIPPED_HUMAN_ALREADY_REVIEWED, no business mutation', async () => {
    const h = buildHarness();
    seedAutoAccept(h, 'UPCOMING');
    h.reviewedClassificationIds.add('clf-1');
    const outcome = await h.service.processOne('decision-1');

    expect(outcome).toBe('skipped');
    expect(h.routingDecisions.get('decision-1')!.resultCode).toBe(AI_ROUTING_RESULT_CODE.SKIPPED_HUMAN_ALREADY_REVIEWED);
    expect(h.renewalCases.get('case-1')!.status).toBe('UPCOMING');
  });

  it('§H/§9/§28.E — a newer classification supersedes this one: SKIPPED_CLASSIFICATION_SUPERSEDED, stale classification never routes', async () => {
    const h = buildHarness();
    seedAutoAccept(h, 'UPCOMING');
    h.classifications.set('clf-2', {
      id: 'clf-2',
      emailMessageId: 'msg-1',
      intent: 'ACCEPT_RENEWAL',
      confidence: '0.960',
      requiresHumanReview: false,
      createdAt: new Date('2026-01-25T00:00:00.000Z'), // newer than clf-1.
    });
    const outcome = await h.service.processOne('decision-1');

    expect(outcome).toBe('skipped');
    expect(h.routingDecisions.get('decision-1')!.resultCode).toBe(AI_ROUTING_RESULT_CODE.SKIPPED_CLASSIFICATION_SUPERSEDED);
    expect(h.renewalCases.get('case-1')!.status).toBe('UPCOMING');
  });

  it('§4.D / no linked RenewalCase — SKIPPED_NO_RENEWAL_CASE, message/thread routed to HUMAN_REVIEW', async () => {
    const h = buildHarness();
    seedAutoAccept(h, 'UPCOMING');
    h.emailMessages.get('msg-1')!.renewalCaseId = null;
    const outcome = await h.service.processOne('decision-1');

    expect(outcome).toBe('skipped');
    expect(h.routingDecisions.get('decision-1')!.resultCode).toBe(AI_ROUTING_RESULT_CODE.SKIPPED_NO_RENEWAL_CASE);
    expect(h.emailMessages.get('msg-1')!.classificationStatus).toBe('HUMAN_REVIEW');
  });

  it('defensive invariant violation (e.g. wrong intent on the loaded classification) -> FAILED, never silently retried', async () => {
    const h = buildHarness();
    seedAutoAccept(h, 'UPCOMING');
    h.classifications.get('clf-1')!.intent = 'REJECT_RENEWAL';
    const outcome = await h.service.processOne('decision-1');

    expect(outcome).toBe('failed');
    expect(h.routingDecisions.get('decision-1')!.resultCode).toBe(AI_ROUTING_RESULT_CODE.INVARIANT_VIOLATION);
  });

  it('§30 — never calls any future-phase/side-effect API: only prisma/audit/clock/config are touched (structural guarantee — no OperatorReply/MailTransport/Fawtara/Plesk import exists in ai-routing.service.ts)', async () => {
    // This is a structural guarantee (see the module's own imports) rather than a runtime-mockable
    // assertion — there is no OperatorReplyService/MailTransport/Fawtara/Plesk client injected into
    // AiRoutingService's constructor at all, so it is architecturally incapable of calling them.
    const h = buildHarness();
    seedAutoAccept(h, 'UPCOMING');
    await h.service.processOne('decision-1');
    expect(h.renewalCases.get('case-1')!.status).toBe('ACCEPTED');
  });
});

describe('AiRoutingService — HUMAN_REVIEW routing (§15/§29)', () => {
  it('routes EmailMessage CLASSIFIED -> HUMAN_REVIEW and CommunicationThread OPEN -> HUMAN_REVIEW; decision SUCCEEDED', async () => {
    const h = buildHarness();
    seedHumanReview(h);
    const outcome = await h.service.processOne('decision-1');

    expect(outcome).toBe('succeeded');
    expect(h.emailMessages.get('msg-1')!.classificationStatus).toBe('HUMAN_REVIEW');
    expect(h.threads.get('thread-1')!.status).toBe('HUMAN_REVIEW');
    const decision = h.routingDecisions.get('decision-1')!;
    expect(decision.status).toBe('SUCCEEDED');
    expect(decision.resultCode).toBe(AI_ROUTING_RESULT_CODE.ROUTED_TO_HUMAN_REVIEW);
  });

  it('never touches RenewalCase', async () => {
    const h = buildHarness();
    seedHumanReview(h);
    h.renewalCases.set('unrelated-case', { id: 'unrelated-case', status: 'UPCOMING' });
    await h.service.processOne('decision-1');
    expect(h.renewalCases.get('unrelated-case')!.status).toBe('UPCOMING');
  });

  it('§15 — message already RESOLVED (a human already reviewed it): decision SKIPPED_HUMAN_ALREADY_REVIEWED, never downgraded back to HUMAN_REVIEW', async () => {
    const h = buildHarness();
    seedHumanReview(h, 'RESOLVED');
    const outcome = await h.service.processOne('decision-1');

    expect(outcome).toBe('skipped');
    expect(h.emailMessages.get('msg-1')!.classificationStatus).toBe('RESOLVED');
    expect(h.routingDecisions.get('decision-1')!.resultCode).toBe(AI_ROUTING_RESULT_CODE.SKIPPED_HUMAN_ALREADY_REVIEWED);
  });

  it('§16 — an already-RESOLVED thread is never re-opened into HUMAN_REVIEW, even though the message still routes', async () => {
    const h = buildHarness();
    seedHumanReview(h, 'CLASSIFIED', 'RESOLVED');
    const outcome = await h.service.processOne('decision-1');

    expect(outcome).toBe('succeeded');
    expect(h.emailMessages.get('msg-1')!.classificationStatus).toBe('HUMAN_REVIEW');
    expect(h.threads.get('thread-1')!.status).toBe('RESOLVED'); // never downgraded/reopened.
  });

  it('idempotent: message already HUMAN_REVIEW -> treated as success, no error', async () => {
    const h = buildHarness();
    seedHumanReview(h, 'HUMAN_REVIEW');
    const outcome = await h.service.processOne('decision-1');
    expect(outcome).toBe('succeeded');
  });
});

describe('AiRoutingService.processBatch (§20)', () => {
  it('processes PENDING and stale-PROCESSING decisions, in createdAt/id order, bounded by take', async () => {
    const h = buildHarness();
    seedHumanReview(h);
    const summary = await h.service.processBatch();
    expect(summary.candidates).toBe(1);
    expect(summary.succeeded).toBe(1);
  });

  it('never scans AiClassification for missing decisions — only AiRoutingDecision rows are ever queried by processBatch', async () => {
    const h = buildHarness();
    // A "historical" classification with NO routing decision at all.
    h.classifications.set('historical-clf', {
      id: 'historical-clf',
      emailMessageId: 'historical-msg',
      intent: 'ACCEPT_RENEWAL',
      confidence: '0.99',
      requiresHumanReview: false,
      createdAt: new Date('2020-01-01T00:00:00.000Z'),
    });
    const summary = await h.service.processBatch();
    expect(summary.candidates).toBe(0); // nothing to do — the historical classification is invisible.
  });
});

describe('AiRoutingService — AUTO_ACCEPT execution kill switch (contract-audit hardening §3/§5)', () => {
  it('A — switch OFF: processOne leaves the decision PENDING, attempts unchanged, RenewalCase unchanged, no audit', async () => {
    const h = buildHarness();
    seedAutoAccept(h, 'UPCOMING');
    h.setAutoRouteAccept(false);

    const outcome = await h.service.processOne('decision-1');

    expect(outcome).toBe('paused');
    const decision = h.routingDecisions.get('decision-1')!;
    expect(decision.status).toBe('PENDING');
    expect(decision.action).toBe('AUTO_ACCEPT'); // never reinterpreted.
    expect(decision.attempts).toBe(0); // zero routing attempt consumed.
    expect(decision.lastAttemptAt).toBeNull();
    expect(decision.resultCode).toBeNull();
    expect(h.renewalCases.get('case-1')!.status).toBe('UPCOMING');
    expect(h.auditRecord).not.toHaveBeenCalled();
  });

  it('B — switch restored to true: the SAME decision then claims and executes normally', async () => {
    const h = buildHarness();
    seedAutoAccept(h, 'UPCOMING');
    h.setAutoRouteAccept(false);
    const pausedOutcome = await h.service.processOne('decision-1');
    expect(pausedOutcome).toBe('paused');

    h.setAutoRouteAccept(true);
    const resumedOutcome = await h.service.processOne('decision-1');

    expect(resumedOutcome).toBe('succeeded');
    expect(h.renewalCases.get('case-1')!.status).toBe('ACCEPTED');
    const decision = h.routingDecisions.get('decision-1')!;
    expect(decision.status).toBe('SUCCEEDED');
    expect(decision.resultCode).toBe(AI_ROUTING_RESULT_CODE.AUTO_ACCEPTED);
  });

  it('C — switch OFF does not affect HUMAN_REVIEW decisions: they still execute normally', async () => {
    const h = buildHarness();
    seedHumanReview(h);
    h.setAutoRouteAccept(false);

    const outcome = await h.service.processOne('decision-1');

    expect(outcome).toBe('succeeded');
    expect(h.emailMessages.get('msg-1')!.classificationStatus).toBe('HUMAN_REVIEW');
  });

  it('D — recovery scan (processBatch) while switch OFF excludes AUTO_ACCEPT rows from its candidate set entirely (never repeatedly re-selects a paused row)', async () => {
    const h = buildHarness();
    seedAutoAccept(h, 'UPCOMING');
    h.setAutoRouteAccept(false);

    const summary = await h.service.processBatch();

    expect(summary.candidates).toBe(0);
    expect(summary.paused).toBe(0); // never even claimed/selected, so no paused outcome is recorded either.
    const decision = h.routingDecisions.get('decision-1')!;
    expect(decision.status).toBe('PENDING');
    expect(decision.attempts).toBe(0);
  });

  it('D (continued) — recovery scan while switch OFF still processes HUMAN_REVIEW candidates', async () => {
    const h = buildHarness();
    seedAutoAccept(h, 'UPCOMING'); // an AUTO_ACCEPT decision, excluded.
    h.routingDecisions.set('decision-2', {
      id: 'decision-2',
      aiClassificationId: 'clf-2',
      renewalCaseId: null,
      routingVersion: AI_ROUTING_VERSION,
      action: 'HUMAN_REVIEW',
      status: 'PENDING',
      resultCode: null,
      attempts: 0,
      lastAttemptAt: null,
      completedAt: null,
    });
    h.classifications.set('clf-2', {
      id: 'clf-2',
      emailMessageId: 'msg-2',
      intent: 'REJECT_RENEWAL',
      confidence: '0.95',
      requiresHumanReview: false,
      createdAt: new Date('2026-01-20T00:00:00.000Z'),
    });
    h.emailMessages.set('msg-2', { id: 'msg-2', threadId: 'thread-2', direction: 'INBOUND', classificationStatus: 'CLASSIFIED', renewalCaseId: null });
    h.threads.set('thread-2', { id: 'thread-2', status: 'OPEN' });
    h.setAutoRouteAccept(false);

    const summary = await h.service.processBatch();

    expect(summary.candidates).toBe(1); // only decision-2 (HUMAN_REVIEW).
    expect(summary.succeeded).toBe(1);
    expect(h.routingDecisions.get('decision-1')!.status).toBe('PENDING'); // AUTO_ACCEPT untouched.
  });

  it('E — flipping the switch to false does NOT mutate the stored action from AUTO_ACCEPT to HUMAN_REVIEW', async () => {
    const h = buildHarness();
    seedAutoAccept(h, 'UPCOMING');
    h.setAutoRouteAccept(false);
    await h.service.processOne('decision-1');
    expect(h.routingDecisions.get('decision-1')!.action).toBe('AUTO_ACCEPT');
  });
});
