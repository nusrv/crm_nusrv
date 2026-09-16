import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import type { MailConfiguration } from '../../generated/prisma/client';
import {
  ActorType,
  ClassificationStatus,
  HealthStatus,
  MessageChannel,
  MessageDirection,
} from '../../generated/prisma/enums';
import { ClockService } from '../../time/clock.service';
import { AuditService } from '../../audit/audit.service';
import { AiClassificationEnqueueService } from '../ai/ai-classification-enqueue.service';
import { isMailConfigEnvironmentAllowed } from './mail-environment-guard';
import { MailImapHealthService } from './mail-imap-health.service';
import { MailInboundCorrelationService } from './mail-inbound-correlation.service';
import { MAX_BODY_TEXT_BYTES, deriveInboundBodyHtml, deriveInboundBodyText } from './mail-inbound-body.util';
import { canonicalizeImapFolder, computeImapIdentityKey } from './imap-identity.util';
import {
  buildReferencesStorageValue,
  parseMessageIdTokens,
  parsePrimaryMessageId,
} from './mail-message-correlation.util';
import { IMAP_AUDIT_EVENT, IMAP_HEALTH_MESSAGE } from './mail-imap-events.constants';
import { DEFAULT_IMAP_SYNC_BATCH_SIZE } from './imap-timing.constants';
import { MAILBOX_READER_FACTORY } from './mailbox-reader';
import type { FetchedMailboxMessage, MailboxReaderFactory } from './mailbox-reader';

export interface ImapConfigSyncResult {
  messagesIngested: number;
  duplicatesSkipped: number;
  humanReviewCount: number;
}

export interface ImapSyncSummary {
  configsProcessed: number;
  configsSkipped: number;
  messagesIngested: number;
  duplicatesSkipped: number;
  humanReviewCount: number;
}

type CursorState = 'UNINITIALIZED' | 'ESTABLISHED' | 'INCONSISTENT';

function sanitizeError(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 1000);
  return 'Unknown IMAP sync error.';
}

/** Codepoint-safe truncation (never splits a surrogate pair) for non-identity VarChar fields —
 * MariaDB VarChar(n) is a CHARACTER (codepoint) limit, not a byte limit, unlike the TEXT columns
 * handled in mail-inbound-body.util.ts. Never used for correlation identity fields (externalMessageId
 * /inReplyTo/references) — those are handled exclusively by mail-message-correlation.util.ts, which
 * REJECTS an over-length token rather than truncating it (truncating an identity risks a false
 * correlation match between two distinct over-length ids sharing a prefix). */
function boundedCharacters(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const codepoints = Array.from(value);
  return codepoints.length <= maxLength ? value : codepoints.slice(0, maxLength).join('');
}

/**
 * Slice C §1-3 (correction pass) — a MailConfiguration's IMAP cursor is exactly one of three
 * states. INCONSISTENT (exactly one of lastSyncUidValidity/lastSyncUid is NULL) must never be
 * silently repaired — it fails closed until a human corrects it, because guessing which half of a
 * partially-written cursor to trust could silently skip or re-import mail.
 */
function classifyCursorState(mailConfiguration: MailConfiguration): CursorState {
  const hasUidValidity = mailConfiguration.lastSyncUidValidity !== null;
  const hasUid = mailConfiguration.lastSyncUid !== null;
  if (!hasUidValidity && !hasUid) return 'UNINITIALIZED';
  if (hasUidValidity && hasUid) return 'ESTABLISHED';
  return 'INCONSISTENT';
}

/**
 * Slice C — the inbound analog of MailOutboundService: this is the one orchestrator that owns
 * sync policy, cursor bootstrap/advancement, dedup, and per-message persistence. It never decides
 * routing/correlation itself (MailInboundCorrelationService's job) and never talks to a mailbox
 * directly (MailboxReader's job) — see mail-inbound-correlation.service.ts and mailbox-reader.ts.
 *
 * DISTRIBUTED OVERLAP (correction pass §4): the primary guard against two overlapping `syncAll()`
 * executions across multiple worker PROCESSES is BullMQ's queue-level `setGlobalConcurrency(1)` on
 * the dedicated IMAP queue (see mail-imap-queue.service.ts) — a real, Redis-backed, distributed
 * limit, not merely this process's local Worker `concurrency: 1`. The cursor CAS below (§1-3) is
 * defense-in-depth on top of that guard, not a replacement for it: even a STALE worker (e.g. one
 * BullMQ considers stalled and has already reassigned the job to) can never move a MailConfiguration's
 * cursor backward or clobber another worker's progress, because every cursor write is a
 * compare-and-swap keyed on the exact row state that worker last observed.
 */
@Injectable()
export class MailInboundIngestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly clock: ClockService,
    private readonly audit: AuditService,
    private readonly health: MailImapHealthService,
    private readonly correlation: MailInboundCorrelationService,
    @Inject(MAILBOX_READER_FACTORY) private readonly readerFactory: MailboxReaderFactory,
    // Slice D §11 — opportunistic post-commit enqueue only; never part of the ingestion
    // transaction itself, and its own failures are swallowed internally (see that service's doc
    // comment) so a Redis outage can never affect inbound ingestion.
    private readonly aiEnqueue: AiClassificationEnqueueService,
  ) {}

  async syncAll(): Promise<ImapSyncSummary> {
    const summary: ImapSyncSummary = {
      configsProcessed: 0,
      configsSkipped: 0,
      messagesIngested: 0,
      duplicatesSkipped: 0,
      humanReviewCount: 0,
    };

    if (this.config.get<string>('IMAP_SYNC_ENABLED') !== 'true') return summary;

    const nodeEnv = this.config.get<string>('NODE_ENV') ?? 'development';
    const enabledConfigs = await this.prisma.mailConfiguration.findMany({ where: { enabled: true } });
    const configs = enabledConfigs.filter((row) => isMailConfigEnvironmentAllowed(row.environment, nodeEnv));

    for (const mailConfiguration of configs) {
      // §4 — each MailConfiguration gets its own try/catch/finally-close isolation: one mailbox's
      // failure (connection error, cursor inconsistency, etc.) must never abort the loop for the
      // rest.
      try {
        const result = await this.syncOneConfig(mailConfiguration);
        summary.configsProcessed += 1;
        summary.messagesIngested += result.messagesIngested;
        summary.duplicatesSkipped += result.duplicatesSkipped;
        summary.humanReviewCount += result.humanReviewCount;
      } catch (error) {
        summary.configsSkipped += 1;
        await this.health.record(mailConfiguration.id, HealthStatus.UNAVAILABLE, sanitizeError(error));
      }
    }

    return summary;
  }

  private async syncOneConfig(mailConfiguration: MailConfiguration): Promise<ImapConfigSyncResult> {
    const result: ImapConfigSyncResult = { messagesIngested: 0, duplicatesSkipped: 0, humanReviewCount: 0 };
    const cursorState = classifyCursorState(mailConfiguration);

    if (cursorState === 'INCONSISTENT') {
      // §1 — fail closed BEFORE ever opening a mailbox connection: a partially-written cursor must
      // never be silently bootstrapped or repaired.
      await this.handleInconsistentCursor(mailConfiguration);
      return result;
    }

    const canonicalFolder = canonicalizeImapFolder(mailConfiguration.imapFolder);
    const reader = this.readerFactory.createReader(mailConfiguration);

    try {
      if (cursorState === 'UNINITIALIZED') {
        // No prior identity to defend, so a plain state read is safe here — the bootstrap CAS
        // itself (§2) is what protects against a concurrent racing bootstrap, not this read.
        const state = await reader.getMailboxState(canonicalFolder);
        await this.establishBootstrapBaselineCas(mailConfiguration, state);
        return result;
      }

      // ESTABLISHED. Deliberately do NOT call getMailboxState() separately here — that would
      // leave a check-then-fetch TOCTOU window (§2 correction pass) in which UIDVALIDITY could
      // change between the check and the fetch. Instead, fetchMessagesSince() performs its own
      // fresh UIDVALIDITY check inside the same mailbox selection it fetches from, and reports a
      // mismatch via `outcome: 'uidvalidity_changed'` before fetching any message source.
      // Non-null: guaranteed by cursorState === 'ESTABLISHED' (classifyCursorState above).
      const uidValidity = mailConfiguration.lastSyncUidValidity!;
      let expectedCursor = mailConfiguration.lastSyncUid!;
      const fetchResult = await reader.fetchMessagesSince(
        canonicalFolder,
        uidValidity,
        expectedCursor,
        DEFAULT_IMAP_SYNC_BATCH_SIZE,
      );

      if (fetchResult.outcome === 'uidvalidity_changed') {
        await this.handleUidValidityChange(mailConfiguration, fetchResult.currentUidValidity);
        return result;
      }
      const messages = fetchResult.messages;

      for (const message of messages) {
        let outcome: { status: 'inserted' | 'duplicate'; humanReview: boolean };
        try {
          outcome = await this.ingestOneMessage(mailConfiguration, canonicalFolder, uidValidity, message);
        } catch (error) {
          // §10 — a failed UID must never advance the cursor past it; stop this run here so the
          // next scheduled tick retries the same UID first, rather than silently skipping it.
          await this.audit.record({
            actorType: ActorType.SYSTEM,
            eventKey: IMAP_AUDIT_EVENT.MESSAGE_INGEST_FAILED,
            subjectType: 'MailConfiguration',
            subjectId: mailConfiguration.id,
            metadata: { uid: message.uid.toString(), uidValidity: uidValidity.toString(), error: sanitizeError(error) },
          });
          await this.health.record(mailConfiguration.id, HealthStatus.DEGRADED, sanitizeError(error));
          return result;
        }

        // §3 — CAS the cursor forward: only advance if the row still matches exactly what we last
        // observed (uidValidity + our locally-tracked expected cursor). "duplicate" (already
        // ingested) advances the cursor exactly like a successful insert — the UID was still
        // successfully HANDLED.
        const advanced = await this.prisma.mailConfiguration.updateMany({
          where: { id: mailConfiguration.id, lastSyncUidValidity: uidValidity, lastSyncUid: expectedCursor },
          data: { lastSyncUid: message.uid, lastSyncedAt: this.clock.now() },
        });

        if (advanced.count === 1) {
          expectedCursor = message.uid;
          if (outcome.status === 'inserted') {
            result.messagesIngested += 1;
            if (outcome.humanReview) result.humanReviewCount += 1;
          } else {
            result.duplicatesSkipped += 1;
          }
          continue;
        }

        // CAS lost — another (possibly stale) worker already touched this row. Re-read and stop
        // this run cleanly in every case; never overwrite, never move the cursor backward.
        const fresh = await this.prisma.mailConfiguration.findUniqueOrThrow({ where: { id: mailConfiguration.id } });
        if (fresh.lastSyncUidValidity !== uidValidity) {
          await this.handleUidValidityChange(mailConfiguration, fresh.lastSyncUidValidity ?? uidValidity);
        } else if (fresh.lastSyncUid !== null && fresh.lastSyncUid >= message.uid) {
          // Another worker already progressed at least this far — benign, not an error.
          await this.audit.record({
            actorType: ActorType.SYSTEM,
            eventKey: IMAP_AUDIT_EVENT.CURSOR_CONFLICT,
            subjectType: 'MailConfiguration',
            subjectId: mailConfiguration.id,
            metadata: {
              reason: 'ALREADY_ADVANCED_BY_ANOTHER_WORKER',
              attemptedUid: message.uid.toString(),
              authoritativeCursor: fresh.lastSyncUid.toString(),
            },
          });
        } else {
          // Cursor is behind where we expected it, but our own expected value didn't match —
          // genuine ownership/conflict situation. Stop safely; never overwrite.
          await this.audit.record({
            actorType: ActorType.SYSTEM,
            eventKey: IMAP_AUDIT_EVENT.CURSOR_CONFLICT,
            subjectType: 'MailConfiguration',
            subjectId: mailConfiguration.id,
            metadata: {
              reason: 'UNEXPECTED_CURSOR_STATE',
              expectedCursor: expectedCursor.toString(),
              attemptedUid: message.uid.toString(),
              authoritativeCursor: fresh.lastSyncUid?.toString() ?? null,
            },
          });
          await this.health.record(mailConfiguration.id, HealthStatus.DEGRADED, 'IMAP cursor conflict detected; sync stopped for this run.');
        }
        return result;
      }

      await this.health.record(
        mailConfiguration.id,
        HealthStatus.HEALTHY,
        messages.length > 0 ? `IMAP sync ingested ${messages.length} message(s).` : 'IMAP sync completed with no new messages.',
      );
      return result;
    } finally {
      await reader.close();
    }
  }

  private async handleInconsistentCursor(mailConfiguration: MailConfiguration): Promise<void> {
    await this.audit.record({
      actorType: ActorType.SYSTEM,
      eventKey: IMAP_AUDIT_EVENT.CURSOR_INCONSISTENT,
      subjectType: 'MailConfiguration',
      subjectId: mailConfiguration.id,
      metadata: {
        lastSyncUidValidity: mailConfiguration.lastSyncUidValidity?.toString() ?? null,
        lastSyncUid: mailConfiguration.lastSyncUid?.toString() ?? null,
      },
    });
    await this.health.record(
      mailConfiguration.id,
      HealthStatus.UNAVAILABLE,
      `${IMAP_HEALTH_MESSAGE.CURSOR_INCONSISTENT_REQUIRES_REVIEW}: exactly one of lastSyncUidValidity/lastSyncUid is NULL; automatic sync stopped pending manual review.`,
    );
  }

  /**
   * §2 — bootstrap must be compare-and-swap: only a worker whose conditional update actually
   * matches (both cursor fields still NULL) wins the right to establish the baseline. A losing
   * worker never overwrites the winner's baseline; it re-reads and either accepts the now-authoritative
   * ESTABLISHED cursor (stopping this run — the next scheduled tick will sync from it) or, in the
   * (should-be-impossible-in-practice) case the row is now INCONSISTENT, fails closed.
   */
  private async establishBootstrapBaselineCas(
    mailConfiguration: MailConfiguration,
    state: { uidValidity: bigint; uidNext: bigint },
  ): Promise<void> {
    // §9 — "enable IMAP now" means "start tracking new mail from this point forward"; no hidden
    // historical backfill. uidNext - 1 may be 0 for a genuinely empty mailbox.
    const baselineUid = state.uidNext > 0n ? state.uidNext - 1n : 0n;
    const won = await this.prisma.mailConfiguration.updateMany({
      where: { id: mailConfiguration.id, lastSyncUidValidity: null, lastSyncUid: null },
      data: { lastSyncUidValidity: state.uidValidity, lastSyncUid: baselineUid, lastSyncedAt: this.clock.now() },
    });

    if (won.count === 1) {
      await this.audit.record({
        actorType: ActorType.SYSTEM,
        eventKey: IMAP_AUDIT_EVENT.SYNC_BASELINE_ESTABLISHED,
        subjectType: 'MailConfiguration',
        subjectId: mailConfiguration.id,
        metadata: { uidValidity: state.uidValidity.toString(), baselineUid: baselineUid.toString() },
      });
      await this.health.record(mailConfiguration.id, HealthStatus.HEALTHY, 'IMAP sync baseline established.');
      return;
    }

    // Another worker's bootstrap CAS won first — never overwrite it.
    const fresh = await this.prisma.mailConfiguration.findUniqueOrThrow({ where: { id: mailConfiguration.id } });
    const freshState = classifyCursorState(fresh);
    if (freshState === 'ESTABLISHED') {
      await this.audit.record({
        actorType: ActorType.SYSTEM,
        eventKey: IMAP_AUDIT_EVENT.CURSOR_CONFLICT,
        subjectType: 'MailConfiguration',
        subjectId: mailConfiguration.id,
        metadata: { reason: 'BOOTSTRAP_LOST_TO_ANOTHER_WORKER', authoritativeUidValidity: fresh.lastSyncUidValidity?.toString() },
      });
      return; // Safe: the next scheduled run will sync from the now-authoritative cursor.
    }
    if (freshState === 'INCONSISTENT') {
      await this.handleInconsistentCursor(fresh);
      return;
    }
    // Still UNINITIALIZED (should not normally happen — another update raced this read away) —
    // safe to leave for the next scheduled tick rather than retry recursively within this run.
  }

  private async handleUidValidityChange(mailConfiguration: MailConfiguration, currentUidValidity: bigint): Promise<void> {
    // §11 — fail closed: never silently reset, never auto re-import, never fall back to
    // externalMessageId as a substitute dedup key. Cursor fields are left untouched.
    await this.audit.record({
      actorType: ActorType.SYSTEM,
      eventKey: IMAP_AUDIT_EVENT.UIDVALIDITY_CHANGED,
      subjectType: 'MailConfiguration',
      subjectId: mailConfiguration.id,
      metadata: {
        storedUidValidity: mailConfiguration.lastSyncUidValidity?.toString(),
        currentUidValidity: currentUidValidity.toString(),
      },
    });
    await this.health.record(
      mailConfiguration.id,
      HealthStatus.UNAVAILABLE,
      `${IMAP_HEALTH_MESSAGE.UIDVALIDITY_CHANGED_REQUIRES_CURSOR_RESET}: automatic sync stopped for this mailbox pending manual cursor reset.`,
    );
  }

  private async ingestOneMessage(
    mailConfiguration: MailConfiguration,
    canonicalFolder: string,
    uidValidity: bigint,
    message: FetchedMailboxMessage,
  ): Promise<{ status: 'inserted' | 'duplicate'; humanReview: boolean }> {
    const identityKey = computeImapIdentityKey({
      mailConfigurationId: mailConfiguration.id,
      canonicalFolder,
      uidValidity,
      uid: message.uid,
    });

    // §6 — INTERNALDATE only, never the sender-controlled Date header; a documented "now" fallback
    // covers the rare case where a reader genuinely could not obtain it.
    const occurredAt = message.internalDate ?? this.clock.now();
    const subject = boundedCharacters(message.subject?.trim() || '(no subject)', 500);
    const fromAddress = boundedCharacters(message.fromAddress ?? 'unknown-sender', 320);
    const bodyText = deriveInboundBodyText(message.text, message.html);
    const bodyHtml = deriveInboundBodyHtml(message.html);
    // Identity fields: parseMessageIdTokens/parsePrimaryMessageId already reject (never truncate)
    // anything malformed or exceeding the VarChar(500) column width — see
    // mail-message-correlation.util.ts. What comes back here is either a complete, valid,
    // as-persisted identifier, or nothing at all.
    const externalMessageId = parsePrimaryMessageId(message.messageIdHeader) ?? undefined;
    const inReplyTo = parsePrimaryMessageId(message.inReplyToHeader) ?? undefined;
    const referenceTokens = parseMessageIdTokens(message.referencesHeader);
    const references = buildReferencesStorageValue(referenceTokens, MAX_BODY_TEXT_BYTES);

    try {
      const transactionResult = await this.prisma.$transaction(async (tx) => {
        const correlation = await this.correlation.correlate(tx, {
          mailConfigurationId: mailConfiguration.id,
          fromAddress: message.fromAddress,
          subject,
          occurredAt,
          inReplyToHeader: message.inReplyToHeader,
          referencesHeader: message.referencesHeader,
          renewalCaseIdHeader: message.renewalCaseIdHeader,
        });
        // §26 — a message the reader could not parse at all is floored to HUMAN_REVIEW regardless
        // of what correlation concluded from its (mostly absent) headers.
        const classificationStatus = message.parseFailed
          ? ClassificationStatus.HUMAN_REVIEW
          : correlation.classificationStatus;

        const emailMessage = await tx.emailMessage.create({
          data: {
            threadId: correlation.threadId,
            customerId: correlation.customerId,
            renewalCaseId: correlation.renewalCaseId,
            direction: MessageDirection.INBOUND,
            channel: MessageChannel.EMAIL,
            externalMessageId,
            inReplyTo,
            references,
            subject,
            fromAddress,
            toAddressesJson: message.toAddresses,
            bodyText,
            bodyHtml,
            occurredAt,
            classificationStatus,
            mailConfigurationId: mailConfiguration.id,
            imapFolder: canonicalFolder,
            imapUid: message.uid,
            imapUidValidity: uidValidity,
            imapIdentityKey: identityKey,
          },
        });

        await this.audit.record(
          {
            actorType: ActorType.SYSTEM,
            eventKey:
              classificationStatus === ClassificationStatus.HUMAN_REVIEW
                ? IMAP_AUDIT_EVENT.INBOUND_CORRELATION_AMBIGUOUS
                : IMAP_AUDIT_EVENT.INBOUND_INGESTED,
            subjectType: 'EmailMessage',
            subjectId: emailMessage.id,
            metadata: {
              mailConfigurationId: mailConfiguration.id,
              threadId: correlation.threadId,
              renewalCaseId: correlation.renewalCaseId,
              uid: message.uid.toString(),
              uidValidity: uidValidity.toString(),
            },
          },
          tx,
        );

        return {
          emailMessageId: emailMessage.id,
          humanReview: classificationStatus === ClassificationStatus.HUMAN_REVIEW,
          classificationStatus,
        };
      });

      // Slice D §11 — opportunistic enqueue AFTER the transaction has committed, never inside it.
      // Only eligible (PENDING) messages are ever worth enqueuing; a HUMAN_REVIEW message from
      // Slice C correlation ambiguity is never queued for automatic classification at all.
      if (transactionResult.classificationStatus === ClassificationStatus.PENDING) {
        await this.aiEnqueue.enqueueIfEnabled(transactionResult.emailMessageId);
      }

      return { status: 'inserted', humanReview: transactionResult.humanReview };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // §8/§24 — imapIdentityKey is the only unique constraint this insert can violate; a losing
        // concurrent insert resolves as already-ingested, never a duplicate row, and is never
        // audited (§29 — no event per duplicate poll). The transaction (including any thread it
        // may have created) has already been fully rolled back by Prisma at this point.
        return { status: 'duplicate', humanReview: false };
      }
      throw error;
    }
  }
}
