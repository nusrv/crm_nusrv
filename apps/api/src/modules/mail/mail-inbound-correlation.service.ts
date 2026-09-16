import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { ClassificationStatus, CustomerStatus, ThreadStatus } from '../../generated/prisma/enums';
import { TERMINAL_STATUSES } from '../renewal-cases/renewal-cases.service';
import { MailInboundSenderResolutionService } from './mail-inbound-sender-resolution.service';
import { MailThreadResolutionService } from './mail-thread-resolution.service';
import { parseMessageIdTokens, parsePrimaryMessageId } from './mail-message-correlation.util';

type TxClient = Prisma.TransactionClient;

type HeaderMatchResult = { kind: 'thread'; threadId: string } | { kind: 'ambiguous' } | { kind: 'none' };

export interface CorrelationOutcome {
  threadId: string;
  customerId: string | null;
  renewalCaseId: string | null;
  classificationStatus: ClassificationStatus;
}

interface CorrelationParams {
  mailConfigurationId: string;
  fromAddress: string | undefined;
  subject: string;
  occurredAt: Date;
  inReplyToHeader: string | undefined;
  referencesHeader: string | undefined;
  renewalCaseIdHeader: string | undefined;
}

/**
 * Slice C §14-24 — the frozen thread-matching priority, implemented in this exact order, never
 * reordered, with no subject similarity and no AI/guessing anywhere in this file:
 *
 *   1. In-Reply-To match (same mailConfigurationId scope)
 *   2. References match (same mailConfigurationId scope)
 *   3. X-Renewal-Case-Id — a correlation HINT, never authorization, requiring sender==case's
 *      customer AND the case's canonical thread (if any) to share this same mailConfigurationId
 *   4. Sender/customer attribution -> a NEW general thread
 *   5. Unknown/ambiguous sender -> a NEW unattributed thread
 *
 * Every branch that would otherwise be ambiguous (multiple candidate threads, a header pointing
 * nowhere resolvable, a sender/thread identity conflict) resolves to HUMAN_REVIEW rather than
 * guessing — this file never picks "first", "newest", or "most likely".
 */
@Injectable()
export class MailInboundCorrelationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly senderResolution: MailInboundSenderResolutionService,
    private readonly threadResolution: MailThreadResolutionService,
  ) {}

  async correlate(tx: TxClient, params: CorrelationParams): Promise<CorrelationOutcome> {
    const inReplyToToken = parsePrimaryMessageId(params.inReplyToHeader);
    const referenceTokens = parseMessageIdTokens(params.referencesHeader);

    const headerMatch = await this.matchByReplyHeaders(tx, params.mailConfigurationId, inReplyToToken, referenceTokens);
    if (headerMatch.kind !== 'none') {
      return this.useExistingThread(tx, headerMatch, params);
    }

    let forcedHumanReview = false;
    const caseHeaderResult = await this.tryRenewalCaseHeader(tx, params);
    if (caseHeaderResult) {
      if (caseHeaderResult.outcome === 'attach') return caseHeaderResult.result;
      forcedHumanReview = true;
    }

    return this.attributeAndCreateGeneralThread(tx, params, forcedHumanReview);
  }

  /** Priority 1 + 2, with the frozen In-Reply-To vs References conflict rule (§16). Returns the
   * single resolved threadId, or null when neither header yields a usable match (falls through to
   * priority 3). Throws (by returning an ambiguous marker consumed by the caller) is deliberately
   * NOT done here — ambiguity is folded into a HUMAN_REVIEW thread via useExistingThread's caller
   * only when a thread WAS found; a pure "multiple candidates, no thread yet" ambiguity has no
   * existing thread to escalate, so it is surfaced as a dedicated unattributed HUMAN_REVIEW
   * outcome directly. */
  private async matchByReplyHeaders(
    tx: TxClient,
    mailConfigurationId: string,
    inReplyToToken: string | null,
    referenceTokens: string[],
  ): Promise<HeaderMatchResult> {
    const inReplyToThreads = inReplyToToken
      ? await this.matchThreadsByExternalIds(tx, mailConfigurationId, [inReplyToToken])
      : new Set<string>();
    const referencesThreads =
      referenceTokens.length > 0
        ? await this.matchThreadsByExternalIds(tx, mailConfigurationId, referenceTokens)
        : new Set<string>();

    if (inReplyToThreads.size > 1) return { kind: 'ambiguous' };
    if (referencesThreads.size > 1) return { kind: 'ambiguous' };

    if (inReplyToThreads.size === 1 && referencesThreads.size === 1) {
      const [a] = inReplyToThreads;
      const [b] = referencesThreads;
      if (a !== b) return { kind: 'ambiguous' };
      return { kind: 'thread', threadId: a! };
    }
    if (inReplyToThreads.size === 1) return { kind: 'thread', threadId: [...inReplyToThreads][0]! };
    if (referencesThreads.size === 1) return { kind: 'thread', threadId: [...referencesThreads][0]! };
    return { kind: 'none' };
  }

  /**
   * Correction pass §3 — email_messages lives under `utf8mb4_unicode_ci` (a case-INSENSITIVE
   * collation, frozen by the Slice A migration; not changed here). A plain `externalMessageId: {in:
   * ids}` query can therefore return a case-insensitive SUPERSET of genuine matches (e.g.
   * "<Case@Test.example>" and "<case@Test.example>" both come back for either query value) — Slice
   * C's frozen rule that Message-ID content is case-sensitive (§13) must still hold. The DB query
   * is treated as a candidate list only; every row is re-checked with exact, case-sensitive
   * JavaScript string equality against the parsed token set BEFORE it is allowed to count as a
   * match, never a locale/lowercase comparison.
   */
  private async matchThreadsByExternalIds(
    tx: TxClient,
    mailConfigurationId: string,
    ids: string[],
  ): Promise<Set<string>> {
    const idSet = new Set(ids);
    const candidates = await tx.emailMessage.findMany({
      where: { mailConfigurationId, externalMessageId: { in: ids } },
      select: { threadId: true, externalMessageId: true },
    });
    const exactMatches = candidates.filter(
      (row) => row.externalMessageId !== null && idSet.has(row.externalMessageId),
    );
    return new Set(exactMatches.map((row) => row.threadId));
  }

  private async useExistingThread(
    tx: TxClient,
    match: Exclude<HeaderMatchResult, { kind: 'none' }>,
    params: CorrelationParams,
  ): Promise<CorrelationOutcome> {
    if (match.kind === 'ambiguous') {
      // §15/§16 — multiple candidate threads, no existing thread to attach to; create a fresh
      // unattributed HUMAN_REVIEW thread rather than guessing which candidate is correct.
      return this.createGeneralThread(tx, params, null, ThreadStatus.HUMAN_REVIEW, ClassificationStatus.HUMAN_REVIEW);
    }

    const thread = await tx.communicationThread.findUniqueOrThrow({
      where: { id: match.threadId },
      select: { id: true, customerId: true, renewalCaseId: true, status: true },
    });

    let classificationStatus: ClassificationStatus = ClassificationStatus.PENDING;
    let escalate = false;

    if (thread.customerId && params.fromAddress) {
      const sender = await this.senderResolution.resolveSenderCustomer(params.fromAddress, tx);
      if (sender.outcome === 'unique' && sender.customerId !== thread.customerId) {
        // §20 — sender conflicts with the thread's Customer: preserve the match, never rewrite
        // the thread's Customer, escalate for a human to look at.
        classificationStatus = ClassificationStatus.HUMAN_REVIEW;
        escalate = true;
      }
    }

    if (thread.renewalCaseId) {
      const renewalCase = await tx.renewalCase.findUniqueOrThrow({
        where: { id: thread.renewalCaseId },
        select: { status: true },
      });
      if (TERMINAL_STATUSES.includes(renewalCase.status)) {
        // §21 — terminal RenewalCase: retain correlation for history, never touch the case.
        classificationStatus = ClassificationStatus.HUMAN_REVIEW;
        escalate = true;
      }
    }

    const nextStatus = escalate
      ? ThreadStatus.HUMAN_REVIEW
      : thread.status === ThreadStatus.RESOLVED
        ? ThreadStatus.OPEN // §21 — reopen on a valid, unambiguous reply.
        : thread.status;

    await tx.communicationThread.update({
      where: { id: thread.id },
      data: {
        status: nextStatus,
        // §23 — monotonic lastMessageAt; never move backward, computed against the CURRENT row.
        lastMessageAt: await this.monotonicLastMessageAt(tx, thread.id, params.occurredAt),
      },
    });

    return {
      threadId: thread.id,
      customerId: thread.customerId,
      renewalCaseId: thread.renewalCaseId,
      classificationStatus,
    };
  }

  private async monotonicLastMessageAt(tx: TxClient, threadId: string, occurredAt: Date): Promise<Date> {
    const current = await tx.communicationThread.findUniqueOrThrow({
      where: { id: threadId },
      select: { lastMessageAt: true },
    });
    return occurredAt > current.lastMessageAt ? occurredAt : current.lastMessageAt;
  }

  /** Priority 3 (§17). Returns null when the header is absent or names a case that does not
   * exist (treated identically to "no hint at all" — not suspicious on its own). Returns
   * `{outcome:'attach', result}` when the case-thread was safely used/created, or
   * `{outcome:'reject'}` when the hint was present but failed its safety checks (sender mismatch
   * or cross-mailConfigurationId thread) — the caller must still land the message somewhere via
   * priority 4/5, forced to HUMAN_REVIEW. */
  private async tryRenewalCaseHeader(
    tx: TxClient,
    params: CorrelationParams,
  ): Promise<{ outcome: 'attach'; result: CorrelationOutcome } | { outcome: 'reject' } | null> {
    const caseId = params.renewalCaseIdHeader?.trim();
    if (!caseId) return null;

    const renewalCase = await tx.renewalCase.findUnique({
      where: { id: caseId },
      select: {
        id: true,
        status: true,
        subscription: { select: { customerId: true } },
        communicationThread: { select: { id: true, mailConfigurationId: true, status: true } },
      },
    });
    if (!renewalCase) return null;

    const sender = params.fromAddress
      ? await this.senderResolution.resolveSenderCustomer(params.fromAddress, tx)
      : { outcome: 'unattributed' as const };
    if (sender.outcome !== 'unique' || sender.customerId !== renewalCase.subscription.customerId) {
      return { outcome: 'reject' };
    }

    if (renewalCase.communicationThread) {
      if (renewalCase.communicationThread.mailConfigurationId !== params.mailConfigurationId) {
        return { outcome: 'reject' };
      }
      // Existing case-thread under the SAME mailConfigurationId: reuse the same reopen/terminal
      // logic as a header-matched existing thread (sender is already known to match here).
      const outcome = await this.useExistingThread(
        tx,
        { kind: 'thread', threadId: renewalCase.communicationThread.id },
        params,
      );
      return { outcome: 'attach', result: outcome };
    }

    const thread = await this.threadResolution.resolveOrCreate(tx, {
      renewalCaseId: renewalCase.id,
      customerId: sender.customerId,
      mailConfigurationId: params.mailConfigurationId,
      subject: params.subject,
      occurredAt: params.occurredAt,
    });

    let classificationStatus: ClassificationStatus = ClassificationStatus.PENDING;
    if (TERMINAL_STATUSES.includes(renewalCase.status)) {
      classificationStatus = ClassificationStatus.HUMAN_REVIEW;
      await tx.communicationThread.update({
        where: { id: thread.id },
        data: { status: ThreadStatus.HUMAN_REVIEW },
      });
    }

    return {
      outcome: 'attach',
      result: { threadId: thread.id, customerId: thread.customerId, renewalCaseId: thread.renewalCaseId, classificationStatus },
    };
  }

  /** Priority 4 + 5 (§18/§19). Always CREATES a new thread — no reuse of a prior general thread,
   * since without a header match there is no basis to know two messages belong to the same
   * conversation. */
  private async attributeAndCreateGeneralThread(
    tx: TxClient,
    params: CorrelationParams,
    forcedHumanReview: boolean,
  ): Promise<CorrelationOutcome> {
    const sender = params.fromAddress
      ? await this.senderResolution.resolveSenderCustomer(params.fromAddress, tx)
      : { outcome: 'unattributed' as const };

    if (sender.outcome === 'unique') {
      const inactive = sender.customerStatus === CustomerStatus.INACTIVE;
      const humanReview = forcedHumanReview || inactive;
      return this.createGeneralThread(
        tx,
        params,
        sender.customerId,
        humanReview ? ThreadStatus.HUMAN_REVIEW : ThreadStatus.OPEN,
        humanReview ? ClassificationStatus.HUMAN_REVIEW : ClassificationStatus.PENDING,
      );
    }

    // Ambiguous or unattributed sender — always HUMAN_REVIEW regardless of forcedHumanReview.
    return this.createGeneralThread(tx, params, null, ThreadStatus.HUMAN_REVIEW, ClassificationStatus.HUMAN_REVIEW);
  }

  private async createGeneralThread(
    tx: TxClient,
    params: CorrelationParams,
    customerId: string | null,
    threadStatus: ThreadStatus,
    classificationStatus: ClassificationStatus,
  ): Promise<CorrelationOutcome> {
    const thread = await tx.communicationThread.create({
      data: {
        customerId,
        renewalCaseId: null,
        mailConfigurationId: params.mailConfigurationId,
        subject: params.subject,
        status: threadStatus,
        lastMessageAt: params.occurredAt,
      },
    });
    return { threadId: thread.id, customerId: thread.customerId, renewalCaseId: null, classificationStatus };
  }
}
