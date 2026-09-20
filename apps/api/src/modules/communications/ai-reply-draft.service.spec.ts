import { jest } from '@jest/globals';
import { AiReplyDraftService } from './ai-reply-draft.service';
import { LlmMalformedOutputError, LlmPermanentError, LlmTransientError } from '../ai/llm-errors';
import { DRAFT_RESULT_SCHEMA_VERSION } from '../ai/llm-gateway';
import { AI_AUDIT_EVENT } from '../ai/ai-events.constants';

function fakeConfig(values: Record<string, string>) {
  return { get: (key: string) => values[key] };
}

const THREAD_ROW = {
  id: 'thread-1',
  subject: 'Renewal notice',
  customerId: 'customer-1',
  renewalCaseId: 'case-1',
  customer: { customerCode: 'C-1', nameEn: 'Acme', nameAr: null, preferredLanguage: 'en' },
  renewalCase: { status: 'PENDING', dueDate: new Date('2026-02-01T00:00:00.000Z'), subscription: { subscriptionCode: 'SUB-1', name: 'Hosting' } },
};

const CURRENT_MESSAGE = {
  id: 'msg-1',
  subject: 'Renewal notice',
  bodyText: 'yes please renew',
  occurredAt: new Date('2026-01-05T00:00:00.000Z'),
};

function buildPrisma(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    communicationThread: {
      findUnique: jest.fn(() => Promise.resolve(THREAD_ROW)),
      update: jest.fn(() => Promise.reject(new Error('must never be called by AiReplyDraftService'))),
    },
    emailMessage: {
      findFirst: jest.fn(() => Promise.resolve(CURRENT_MESSAGE)),
      findMany: jest.fn(() => Promise.resolve([])),
      create: jest.fn(() => Promise.reject(new Error('must never be called by AiReplyDraftService'))),
    },
    operatorReplyOutbox: {
      create: jest.fn(() => Promise.reject(new Error('must never be called by AiReplyDraftService'))),
    },
    renewalCase: {
      update: jest.fn(() => Promise.reject(new Error('must never be called by AiReplyDraftService'))),
    },
    subscription: {
      update: jest.fn(() => Promise.reject(new Error('must never be called by AiReplyDraftService'))),
    },
    ...overrides,
  };
}

function buildService(opts: {
  aiEnabled?: boolean;
  prisma?: ReturnType<typeof buildPrisma>;
  effectiveClassification?: { getEffectiveClassification: jest.Mock };
  gateway?: { draftReply: jest.Mock };
  audit?: { record: jest.Mock };
  health?: { record: jest.Mock };
}) {
  const prisma = opts.prisma ?? buildPrisma();
  const audit = opts.audit ?? { record: jest.fn(() => Promise.resolve()) };
  const health = opts.health ?? { record: jest.fn(() => Promise.resolve()) };
  const effectiveClassification =
    opts.effectiveClassification ?? { getEffectiveClassification: jest.fn(() => Promise.reject(new Error('not found'))) };
  const gateway =
    opts.gateway ??
    { draftReply: jest.fn(() => Promise.resolve({ schemaVersion: DRAFT_RESULT_SCHEMA_VERSION, bodyText: 'Thanks!', language: 'en' })) };
  const config = fakeConfig({ AI_ENABLED: opts.aiEnabled === false ? 'false' : 'true', AI_PROVIDER: 'mock' });

  const service = new AiReplyDraftService(
    prisma as never,
    config as never,
    audit as never,
    health as never,
    effectiveClassification as never,
    gateway as never,
  );
  return { service, prisma, audit, health, effectiveClassification, gateway };
}

describe('AiReplyDraftService (Slice F §15)', () => {
  it('§6 — AI_ENABLED=false fails safely with AI_ASSISTANCE_DISABLED, zero provider calls, zero DB reads', async () => {
    const { service, prisma, gateway } = buildService({ aiEnabled: false });

    await expect(service.generateDraft('thread-1', 'user-1')).rejects.toThrow('AI_ASSISTANCE_DISABLED');
    expect(gateway.draftReply).not.toHaveBeenCalled();
    expect(prisma.communicationThread.findUnique).not.toHaveBeenCalled();
  });

  it('unknown thread -> 404, zero provider calls', async () => {
    const prisma = buildPrisma({ communicationThread: { findUnique: jest.fn(() => Promise.resolve(null)) } });
    const { service, gateway } = buildService({ prisma });

    await expect(service.generateDraft('missing', 'user-1')).rejects.toThrow();
    expect(gateway.draftReply).not.toHaveBeenCalled();
  });

  it('§7 — no inbound message in the thread -> NO_INBOUND_MESSAGE_TO_REPLY_TO, zero provider calls', async () => {
    const prisma = buildPrisma({ emailMessage: { findFirst: jest.fn(() => Promise.resolve(null)), findMany: jest.fn() } });
    const { service, gateway } = buildService({ prisma });

    await expect(service.generateDraft('thread-1', 'user-1')).rejects.toThrow('NO_INBOUND_MESSAGE_TO_REPLY_TO');
    expect(gateway.draftReply).not.toHaveBeenCalled();
  });

  it('§8 — no classification exists: proceeds cautiously with effectiveClassification: null, never fabricated', async () => {
    const { service, gateway } = buildService({});

    await service.generateDraft('thread-1', 'user-1');

    const calledWith = gateway.draftReply.mock.calls[0]![0] as { effectiveClassification: unknown };
    expect(calledWith.effectiveClassification).toBeNull();
  });

  it('§8 — an existing effective classification (human-reviewed) is passed through to the drafting context', async () => {
    const effectiveClassification = {
      getEffectiveClassification: jest.fn(() =>
        Promise.resolve({
          emailMessageId: 'msg-1',
          source: 'HUMAN_REVIEW' as const,
          effectiveIntent: 'REQUEST_INVOICE',
          effectiveResult: { intent: 'REQUEST_INVOICE', summary: 'Wants an invoice.', language: 'en' },
          aiClassificationId: 'ai-1',
          reviewId: 'review-1',
          createdAt: new Date(),
        }),
      ),
    };
    const { service, gateway } = buildService({ effectiveClassification });

    await service.generateDraft('thread-1', 'user-1');

    const calledWith = gateway.draftReply.mock.calls[0]![0] as { effectiveClassification: { source: string; intent: string } };
    expect(calledWith.effectiveClassification).toEqual({ source: 'HUMAN_REVIEW', intent: 'REQUEST_INVOICE', summary: 'Wants an invoice.', language: 'en' });
  });

  it('§11 — subject is deterministic (normalizeReplySubject), never taken from the gateway result', async () => {
    const { service } = buildService({});
    const result = await service.generateDraft('thread-1', 'user-1');
    expect(result.subject).toBe('Re: Renewal notice');
  });

  it('successful generation returns bodyText/language/schemaVersion from the gateway and records AI health HEALTHY', async () => {
    const { service, health } = buildService({});
    const result = await service.generateDraft('thread-1', 'user-1');
    expect(result).toEqual({ subject: 'Re: Renewal notice', bodyText: 'Thanks!', language: 'en', schemaVersion: DRAFT_RESULT_SCHEMA_VERSION });
    expect(health.record).toHaveBeenCalledWith('HEALTHY', expect.any(String));
  });

  it('§17 — the audit event contains only safe metadata: never the generated bodyText, never the customer bodyText', async () => {
    const { service, audit } = buildService({});
    await service.generateDraft('thread-1', 'user-1');

    expect(audit.record).toHaveBeenCalledTimes(1);
    const call = audit.record.mock.calls[0]![0] as { eventKey: string; metadata: Record<string, unknown> };
    expect(call.eventKey).toBe(AI_AUDIT_EVENT.REPLY_DRAFT_GENERATED);
    expect(Object.keys(call.metadata).sort()).toEqual(
      ['customerId', 'language', 'model', 'provider', 'renewalCaseId', 'schemaVersion', 'sourceEmailMessageId', 'threadId'].sort(),
    );
    const serialized = JSON.stringify(call.metadata);
    expect(serialized).not.toContain('Thanks!');
    expect(serialized).not.toContain('yes please renew');
  });

  it('§18 — a transient provider failure records AI health DEGRADED and fails safely, without a noisy audit event', async () => {
    const gateway = { draftReply: jest.fn(() => Promise.reject(new LlmTransientError('rate limited'))) };
    const { service, health, audit } = buildService({ gateway });

    await expect(service.generateDraft('thread-1', 'user-1')).rejects.toThrow('AI_ASSISTANCE_TEMPORARILY_UNAVAILABLE');
    expect(health.record).toHaveBeenCalledWith('DEGRADED', expect.any(String));
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('§18 — a permanent/auth provider failure records AI health UNAVAILABLE and fails safely', async () => {
    const gateway = { draftReply: jest.fn(() => Promise.reject(new LlmPermanentError('invalid api key'))) };
    const { service, health } = buildService({ gateway });

    await expect(service.generateDraft('thread-1', 'user-1')).rejects.toThrow('AI_ASSISTANCE_UNAVAILABLE');
    expect(health.record).toHaveBeenCalledWith('UNAVAILABLE', expect.any(String));
  });

  it('§18 — a malformed structured output is a message-level failure only: no health call, safe error', async () => {
    const gateway = { draftReply: jest.fn(() => Promise.reject(new LlmMalformedOutputError('bad json'))) };
    const { service, health } = buildService({ gateway });

    await expect(service.generateDraft('thread-1', 'user-1')).rejects.toThrow('AI_DRAFT_GENERATION_FAILED');
    expect(health.record).not.toHaveBeenCalled();
  });

  it('§23 — generation never creates an OperatorReplyOutbox row, an outbound EmailMessage, or mutates RenewalCase/Subscription/CommunicationThread', async () => {
    const { service, prisma } = buildService({});
    await service.generateDraft('thread-1', 'user-1');

    expect(prisma.operatorReplyOutbox.create).not.toHaveBeenCalled();
    expect(prisma.emailMessage.create).not.toHaveBeenCalled();
    expect(prisma.communicationThread.update).not.toHaveBeenCalled();
    expect(prisma.renewalCase.update).not.toHaveBeenCalled();
    expect(prisma.subscription.update).not.toHaveBeenCalled();
  });

  it('§24 — the generated bodyText is never written anywhere by this service (fully ephemeral: no draft persistence call exists at all)', async () => {
    const { service, prisma } = buildService({});
    await service.generateDraft('thread-1', 'user-1');
    // The only prisma writes this service is even capable of are the ones stubbed above (and
    // rejected if called) — there is no draft-table write path in AiReplyDraftService at all.
    expect(prisma.emailMessage.create).not.toHaveBeenCalled();
  });
});
