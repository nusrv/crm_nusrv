import { summarizeSmtpEvidence } from '../mail/smtp-evidence-summary';
import { BadRequestException, ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { AuditService } from '../../audit/audit.service';
import { PrismaService } from '../../database/prisma.service';
import { ClockService } from '../../time/clock.service';
import { Prisma } from '../../generated/prisma/client';
import { ActorType, MessageChannel, MessageDirection } from '../../generated/prisma/enums';
import { CustomerEmailResolutionService } from '../customers/customer-email-resolution.service';
import { MailConfigurationResolverService } from '../mail/mail-configuration-resolver.service';
import { generateStableMessageId } from '../mail/mail-message-id.util';
import { hasRecordedSmtpAcceptance, resendAuthorizationSchema } from '../mail/outbound-resend-policy';
import { COMMUNICATION_AUDIT_EVENT } from './communications-events.constants';
import { deriveReplyThreadingHeaders, MAX_THREADING_CANDIDATE_MESSAGES, normalizeReplySubject } from './reply-threading.util';

export interface QueueReplyInput {
  threadId: string;
  actorId: string;
  idempotencyKey: string;
  subject?: string;
  bodyText: string;
}

export interface QueueReplyResult {
  outboxId: string;
  emailMessageId: string;
  threadId: string;
  status: string;
}

/**
 * Slice E §8-§11/§15/§16 — the ONE place a human operator reply is created. Never calls SMTP
 * (OperatorReplyOutboundService/the worker owns that — see that file's doc comment); this service
 * only ever persists. Recipient is resolved here, server-side, from the thread/customer's
 * authoritative email — never trusted from client input (there is no "to" field in the DTO at all).
 * The pinned mailbox is the thread's own mailConfigurationId — never re-resolved to a different
 * BillingEntity/global mailbox (§9); an unusable pinned mailbox or missing recipient fails the HTTP
 * request outright (no partial DB writes), matching §8's "fail safely."
 */
@Injectable()
export class OperatorReplyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clock: ClockService,
    private readonly mailConfigResolver: MailConfigurationResolverService,
    private readonly emailResolution: CustomerEmailResolutionService,
  ) {}

  async queueReply(input: QueueReplyInput): Promise<QueueReplyResult> {
    return this.attemptQueueReply(input, 0);
  }

  async evidence(threadId: string, outboxId: string) {
    const row = await this.prisma.operatorReplyOutbox.findFirst({
      where: { id: outboxId, threadId },
      select: { id: true, attempts: true, smtpUncertain: true, resendOfId: true, status: true, lastError: true },
    });
    if (!row) throw new NotFoundException('Reply not found.');
    const events = await this.prisma.auditEvent.findMany({
      where: { subjectType: 'OperatorReplyOutbox', subjectId: outboxId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, eventKey: true, actorId: true, actorType: true, metadata: true, createdAt: true },
      take: 101,
    });
    return { ...row, events: events.slice(0, 100), smtpEvidence: summarizeSmtpEvidence('OperatorReplyOutbox', events, events.length > 100) };
  }

  async resend(threadId: string, outboxId: string, value: unknown, actorId: string) {
    const parsed = resendAuthorizationSchema.safeParse(value);
    if (!parsed.success) throw new BadRequestException('Acknowledge the risk of duplicate delivery before resending.');
    const idempotencyKey = parsed.data.idempotencyKey;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const prior = await tx.operatorReplyOutbox.findUnique({ where: { actorId_idempotencyKey: { actorId, idempotencyKey } } });
        if (prior) {
          if (prior.resendOfId !== outboxId || prior.threadId !== threadId)
            throw new ConflictException('Request identity already used for a different reply.');
          return this.toResult(prior);
        }
        const original = await tx.operatorReplyOutbox.findFirst({
          where: { id: outboxId, threadId },
          include: { thread: true, emailMessage: true, mailConfiguration: true },
        });
        if (!original) throw new NotFoundException('Reply not found.');
        if (original.status !== 'FAILED' || !original.smtpUncertain ||
            await hasRecordedSmtpAcceptance(tx, 'OperatorReplyOutbox', outboxId) ||
            await tx.operatorReplyOutbox.findUnique({ where: { resendOfId: outboxId } })) {
          throw new ConflictException('This reply is not eligible for an authorized resend.');
        }
        const customerId = original.thread.customerId;
        if (!customerId || (await this.emailResolution.resolvePrimaryRecipient(customerId, tx))?.email !== original.recipient)
          throw new ConflictException('The original recipient is no longer registered for this thread.');
        const config = this.mailConfigResolver.resolvePinned(original.mailConfiguration, { checkCutover: false });
        if (!config.usable) throw new UnprocessableEntityException('Reply mailbox is unavailable.');
        const now = this.clock.now();
        const { subject, bodyText, inReplyTo, references } = original.emailMessage;
        const message = await tx.emailMessage.create({
          data: {
            threadId, customerId, renewalCaseId: original.thread.renewalCaseId,
            direction: MessageDirection.OUTBOUND, channel: MessageChannel.EMAIL,
            subject, bodyText, inReplyTo, references, fromAddress: config.config.fromAddress,
            toAddressesJson: [original.recipient], occurredAt: now, mailConfigurationId: config.config.id,
            externalMessageId: generateStableMessageId(config.config.fromAddress),
          },
        });
        const queued = await tx.operatorReplyOutbox.create({
          data: { threadId, mailConfigurationId: config.config.id, emailMessageId: message.id,
            recipient: original.recipient, idempotencyKey, actorId, resendOfId: outboxId },
        });
        await tx.communicationThread.update({ where: { id: threadId }, data: { lastMessageAt: now } });
        await this.audit.record({
          actorType: ActorType.USER, actorId, eventKey: 'communication.reply.resend_authorized',
          subjectType: 'OperatorReplyOutbox', subjectId: queued.id,
          metadata: { resendOfId: outboxId, duplicateRiskAcknowledged: true, emailMessageId: message.id },
        }, tx);
        return this.toResult(queued);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code)) {
        const existing = await this.prisma.operatorReplyOutbox.findUnique({ where: { actorId_idempotencyKey: { actorId, idempotencyKey } } });
        if (existing?.threadId === threadId && existing.resendOfId === outboxId) return this.toResult(existing);
        throw new ConflictException('The reply was changed or already authorized for resend.');
      }
      throw error;
    }
  }

  /** §15 hardening — verified live against real InnoDB: a genuine concurrent double-submit with
   * the SAME (actorId, idempotencyKey) does not always surface as the clean P2002 unique-constraint
   * error a hand-rolled fake always produces. Depending on lock-wait timing, MariaDB/Prisma can
   * instead report P2034 ("transaction failed due to a write conflict or a deadlock") for the
   * losing transaction. P2034 is Prisma's own documented safe-to-retry error, so the loser retries
   * this whole method ONCE (bounded — never an unbounded loop): the retry's own idempotency
   * short-circuit below will find the winner's by-then-committed row, or — if the conflict was
   * unrelated to this key — the retried attempt simply succeeds on its own. */
  private async attemptQueueReply(input: QueueReplyInput, attempt: number): Promise<QueueReplyResult> {
    const thread = await this.prisma.communicationThread.findUnique({
      where: { id: input.threadId },
      include: { mailConfiguration: true },
    });
    if (!thread) throw new NotFoundException('Communication thread not found.');

    // §3 contract-audit correction — the idempotency equivalence check must compare the EXACT
    // subject that would actually be persisted, computed the identical way the persistence path
    // below computes it (an explicit operator-supplied subject is used as-is and never itself
    // re-normalized; an omitted subject is derived from the thread's own subject). Computed here,
    // before the idempotency short-circuit, specifically so that check has it available.
    const effectiveSubject = input.subject?.trim() || normalizeReplySubject(thread.subject);

    // §15 — fast idempotent short-circuit: a retried/duplicate submission with the same
    // (actorId, idempotencyKey) never does the work twice. The actual safety guarantee is the DB
    // composite-unique constraint below, not this read (which only avoids redundant work on the
    // common, non-racing path). Scoped to actorId — a different operator who coincidentally
    // generated the same client key can never collide with, or retrieve, this actor's own reply.
    const existing = await this.findExistingForActor(input.actorId, input.idempotencyKey);
    if (existing) return this.resolveExisting(existing, input, effectiveSubject);

    // §9 — the thread's own pinned mailbox only, never re-resolved to another BillingEntity/global
    // configuration, and never silently falls back if unusable.
    // Operator-originated replies are independent of automatic-reminder cutover.
    // Keep the mailbox enablement/environment gates, but do not strand a
    // human-approved reply behind an unrelated outbound scheduler watermark.
    const configResolution = this.mailConfigResolver.resolvePinned(
      thread.mailConfiguration,
      { checkCutover: false },
    );
    if (!configResolution.usable) {
      throw new UnprocessableEntityException(`Reply mailbox is unavailable (${configResolution.reason}).`);
    }

    // §8 — recipient resolved server-side only; a thread with no attributed customer (e.g. an
    // unresolved Slice C sender) has no authoritative recipient at all.
    if (!thread.customerId) {
      throw new UnprocessableEntityException('This thread has no attributed customer; no authoritative recipient is available.');
    }
    const resolvedRecipient = await this.emailResolution.resolvePrimaryRecipient(thread.customerId);
    if (!resolvedRecipient) {
      throw new UnprocessableEntityException('No active primary email address is on file for this customer.');
    }

    // §10 — bounded, newest-first candidate window; deriveReplyThreadingHeaders() searches it for
    // the first message with a VALID externalMessageId rather than trusting the latest one blindly.
    const threadingCandidates = await this.prisma.emailMessage.findMany({
      where: { threadId: thread.id },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: MAX_THREADING_CANDIDATE_MESSAGES,
      select: { externalMessageId: true, references: true },
    });
    const threading = deriveReplyThreadingHeaders(threadingCandidates);
    const messageIdHeader = generateStableMessageId(configResolution.config.fromAddress);
    const now = this.clock.now();

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const emailMessage = await tx.emailMessage.create({
          data: {
            threadId: thread.id,
            customerId: thread.customerId,
            renewalCaseId: thread.renewalCaseId,
            direction: MessageDirection.OUTBOUND,
            channel: MessageChannel.EMAIL,
            subject: effectiveSubject,
            fromAddress: configResolution.config.fromAddress,
            toAddressesJson: [resolvedRecipient.email],
            bodyText: input.bodyText,
            occurredAt: now,
            mailConfigurationId: configResolution.config.id,
            externalMessageId: messageIdHeader,
            inReplyTo: threading.inReplyTo,
            references: threading.references,
          },
        });
        const outbox = await tx.operatorReplyOutbox.create({
          data: {
            threadId: thread.id,
            mailConfigurationId: configResolution.config.id,
            emailMessageId: emailMessage.id,
            recipient: resolvedRecipient.email,
            idempotencyKey: input.idempotencyKey,
            actorId: input.actorId,
          },
        });
        // A reply is itself new activity on the thread — bump lastMessageAt so the list's default
        // lastMessageAt DESC ordering surfaces it immediately, matching every other message-arrival
        // path (Slice B/C) that already does the same.
        await tx.communicationThread.update({ where: { id: thread.id }, data: { lastMessageAt: now } });
        await this.audit.record(
          {
            actorType: ActorType.USER,
            actorId: input.actorId,
            eventKey: COMMUNICATION_AUDIT_EVENT.REPLY_QUEUED,
            subjectType: 'EmailMessage',
            subjectId: emailMessage.id,
            metadata: {
              threadId: thread.id,
              outboxId: outbox.id,
              customerId: thread.customerId,
              renewalCaseId: thread.renewalCaseId,
            },
          },
          tx,
        );
        return outbox;
      });
      return this.toResult(created);
    } catch (error) {
      // §15 — a genuine concurrent double-submit with the SAME (actorId, idempotencyKey): the
      // composite-unique constraint rejects the loser's insert (rolling back its just-created
      // EmailMessage too, since both writes share one transaction), and the loser returns the
      // winner's own result — never a second logical reply. If no matching row is found here, this
      // P2002 was NOT about this actor's idempotency key (e.g. an astronomically unlikely
      // emailMessageId UUID collision) — fall through and rethrow rather than swallowing it.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const winner = await this.findExistingForActor(input.actorId, input.idempotencyKey);
        if (winner) return this.resolveExisting(winner, input, effectiveSubject);
      }
      // See this method's doc comment — a live-verified alternate shape of the same race.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034' && attempt < 1) {
        return this.attemptQueueReply(input, attempt + 1);
      }
      throw error;
    }
  }

  /** The composite-unique lookup — (actorId, idempotencyKey), never the bare key alone. Includes
   * the linked EmailMessage's bodyText AND subject so resolveExisting() can tell an ordinary
   * idempotent retry apart from a client bug reusing the same key for a genuinely different
   * request (§ contract audit — subject is now part of that equivalence check, see
   * resolveExisting()'s own doc comment). */
  private async findExistingForActor(actorId: string, idempotencyKey: string) {
    return this.prisma.operatorReplyOutbox.findUnique({
      where: { actorId_idempotencyKey: { actorId, idempotencyKey } },
      include: { emailMessage: { select: { bodyText: true, subject: true } } },
    });
  }

  /**
   * §15/§3 contract audit — same actor + same idempotencyKey + the SAME logical request (identical
   * thread, body, AND effective subject) is an ordinary idempotent retry: return the
   * already-persisted result. Same actor + same idempotencyKey + a DIFFERENT thread, body, or
   * effective subject is a client bug (key reuse across unrelated requests) — reject explicitly
   * with 409 rather than silently returning a result the caller did not actually ask for.
   *
   * `effectiveSubject` is exactly what the persistence path would write to EmailMessage.subject —
   * the caller MUST compute it identically to that path (input.subject?.trim() ||
   * normalizeReplySubject(thread.subject)) before calling this. Deliberately NOT re-normalized
   * here beyond that: an operator-supplied subject is compared as-is (never itself passed through
   * normalizeReplySubject a second time), so two explicit-but-differently-cased/prefixed subject
   * strings (e.g. "Re: X" vs "RE: X") are treated as materially different requests and correctly
   * 409 — only the auto-derived (omitted-subject) path is deterministic enough to ever coincide
   * across two calls.
   */
  private resolveExisting(
    existing: { id: string; emailMessageId: string; threadId: string; status: string; resendOfId?: string | null; emailMessage: { bodyText: string; subject: string } },
    input: QueueReplyInput,
    effectiveSubject: string,
  ): QueueReplyResult {
    if (
      existing.threadId !== input.threadId || existing.resendOfId ||
      existing.emailMessage.bodyText !== input.bodyText ||
      existing.emailMessage.subject !== effectiveSubject
    ) {
      throw new ConflictException(
        'This idempotency key was already used for a different reply. Use a new idempotency key for a new request.',
      );
    }
    return this.toResult(existing);
  }

  private toResult(row: { id: string; emailMessageId: string; threadId: string; status: string }): QueueReplyResult {
    return { outboxId: row.id, emailMessageId: row.emailMessageId, threadId: row.threadId, status: row.status };
  }
}
