import { Injectable, NotFoundException } from '@nestjs/common';
import { pageMetadata } from '../../common/page-query.dto';
import { AuditService } from '../../audit/audit.service';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { ActorType, ClassificationStatus, MessageDirection, ThreadStatus } from '../../generated/prisma/enums';
import { EffectiveClassificationService } from '../ai/effective-classification.service';
import { COMMUNICATION_AUDIT_EVENT } from './communications-events.constants';
import type { ThreadListQueryDto } from './communication-threads.dto';

const MAX_PREVIEW_CHARS = 140;

function preview(bodyText: string): string {
  return bodyText.length > MAX_PREVIEW_CHARS ? `${bodyText.slice(0, MAX_PREVIEW_CHARS)}…` : bodyText;
}

export interface ThreadListItem {
  id: string;
  subject: string;
  status: ThreadStatus;
  renewalCaseId: string | null;
  lastMessageAt: Date;
  customer: { id: string; customerCode: string; nameEn: string | null; nameAr: string | null; primaryEmail: string } | null;
  mailConfiguration: { id: string; label: string };
  latestMessage: { direction: MessageDirection; preview: string; occurredAt: Date } | null;
  pendingHumanReviewCount: number;
  requiresAttention: boolean;
}

export interface ThreadListResult {
  data: ThreadListItem[];
  meta: { total: number; page: number; pageSize: number; pageCount: number };
}

export interface EffectiveClassificationSummary {
  source: 'AI' | 'HUMAN_REVIEW';
  effectiveIntent: string;
  effectiveResult: unknown;
  // The AiClassification a human correction must target (§7 — reuses Slice D's existing review
  // endpoint directly; this id is never itself editable, only passed through).
  aiClassificationId: string;
  createdAt: Date;
}

export interface ThreadDetailMessage {
  id: string;
  direction: MessageDirection;
  subject: string;
  fromAddress: string;
  toAddresses: unknown;
  bodyText: string;
  occurredAt: Date;
  classificationStatus: ClassificationStatus | null;
  deliveryStatus: string | null;
  deliveryError: string | null;
  effectiveClassification: EffectiveClassificationSummary | null;
}

/**
 * Slice E §4/§5/§17 — thread list/detail read model, and the (only) explicit thread-status action
 * this slice exposes (resolve). Never loads full message bodies in the list endpoint (§4); detail
 * loads the full chronological history for exactly one thread, bounded by realistic conversation
 * length, never paginated separately in V1.
 */
@Injectable()
export class CommunicationThreadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly effectiveClassification: EffectiveClassificationService,
  ) {}

  async list(query: ThreadListQueryDto): Promise<ThreadListResult> {
    const search = query.search?.trim();
    const filters: Prisma.CommunicationThreadWhereInput[] = [];
    if (query.status) filters.push({ status: query.status });
    if (query.renewalCaseId) filters.push({ renewalCaseId: query.renewalCaseId });
    if (query.attention) {
      filters.push({
        OR: [
          { status: ThreadStatus.HUMAN_REVIEW },
          {
            messages: {
              some: { direction: MessageDirection.INBOUND, classificationStatus: ClassificationStatus.HUMAN_REVIEW },
            },
          },
        ],
      });
    }
    if (search) {
      filters.push({
        OR: [
          { subject: { contains: search } },
          { customer: { customerCode: { contains: search } } },
          { customer: { nameEn: { contains: search } } },
          { customer: { nameAr: { contains: search } } },
          { customer: { primaryEmail: { contains: search } } },
        ],
      });
    }
    const where: Prisma.CommunicationThreadWhereInput = filters.length ? { AND: filters } : {};

    const [rows, total] = await Promise.all([
      this.prisma.communicationThread.findMany({
        where,
        include: {
          customer: { select: { id: true, customerCode: true, nameEn: true, nameAr: true, primaryEmail: true } },
          mailConfiguration: { select: { id: true, label: true } },
          // Prisma limits this per-parent-row via a single query, not one round-trip per thread.
          messages: {
            orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
            take: 1,
            select: { direction: true, bodyText: true, occurredAt: true },
          },
          _count: {
            select: {
              messages: {
                where: { direction: MessageDirection.INBOUND, classificationStatus: ClassificationStatus.HUMAN_REVIEW },
              },
            },
          },
        },
        orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.communicationThread.count({ where }),
    ]);

    const data = rows.map((thread) => {
      const latest = thread.messages[0];
      return {
        id: thread.id,
        subject: thread.subject,
        status: thread.status,
        renewalCaseId: thread.renewalCaseId,
        lastMessageAt: thread.lastMessageAt,
        customer: thread.customer,
        mailConfiguration: thread.mailConfiguration,
        latestMessage: latest ? { direction: latest.direction, preview: preview(latest.bodyText), occurredAt: latest.occurredAt } : null,
        pendingHumanReviewCount: thread._count.messages,
        requiresAttention: thread.status === ThreadStatus.HUMAN_REVIEW || thread._count.messages > 0,
      };
    });

    return { data, meta: pageMetadata(total, query.page, query.pageSize) };
  }

  async detail(threadId: string): Promise<{
    id: string;
    subject: string;
    status: ThreadStatus;
    lastMessageAt: Date;
    customer: { id: string; customerCode: string; nameEn: string | null; nameAr: string | null; primaryEmail: string; status: string } | null;
    mailConfiguration: { id: string; label: string; environment: string; enabled: boolean };
    renewalCase: { id: string; status: string; dueDate: Date; subscription: { id: string; subscriptionCode: string; name: string } } | null;
    messages: ThreadDetailMessage[];
  }> {
    const thread = await this.prisma.communicationThread.findUnique({
      where: { id: threadId },
      include: {
        customer: {
          select: { id: true, customerCode: true, nameEn: true, nameAr: true, primaryEmail: true, status: true },
        },
        mailConfiguration: { select: { id: true, label: true, environment: true, enabled: true } },
        renewalCase: {
          select: {
            id: true,
            status: true,
            dueDate: true,
            subscription: { select: { id: true, subscriptionCode: true, name: true } },
          },
        },
        messages: {
          orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            direction: true,
            subject: true,
            fromAddress: true,
            toAddressesJson: true,
            bodyText: true,
            occurredAt: true,
            classificationStatus: true,
            outboxEntry: { select: { status: true, lastError: true } },
            operatorReplyOutboxEntry: { select: { status: true, lastError: true } },
          },
        },
      },
    });
    if (!thread) throw new NotFoundException('Communication thread not found.');

    const messages = await Promise.all(
      thread.messages.map(async (message) => {
        let effectiveClassification: EffectiveClassificationSummary | null = null;
        if (message.classificationStatus !== null) {
          // §6 — every inbound message that has ever been classified gets its effective result;
          // never duplicates EffectiveClassificationService's own ordering logic (§22 elsewhere).
          effectiveClassification = await this.effectiveClassification
            .getEffectiveClassification(message.id)
            .catch(() => null);
        }
        const delivery = message.outboxEntry ?? message.operatorReplyOutboxEntry;
        return {
          id: message.id,
          direction: message.direction,
          subject: message.subject,
          fromAddress: message.fromAddress,
          toAddresses: message.toAddressesJson,
          // §5/§18 — bodyText only, never bodyHtml, never raw MIME.
          bodyText: message.bodyText,
          occurredAt: message.occurredAt,
          classificationStatus: message.classificationStatus,
          deliveryStatus: delivery?.status ?? null,
          deliveryError: delivery?.lastError ?? null,
          effectiveClassification,
        };
      }),
    );

    return {
      id: thread.id,
      subject: thread.subject,
      status: thread.status,
      lastMessageAt: thread.lastMessageAt,
      customer: thread.customer,
      mailConfiguration: thread.mailConfiguration,
      renewalCase: thread.renewalCase,
      messages,
    };
  }

  /** §17/§20 — ADMIN + SALES_DEVELOPMENT only (enforced by the controller's @Roles), changes only
   * CommunicationThread.status, never RenewalCase. Idempotent: resolving an already-RESOLVED
   * thread is a safe no-op, not an error. */
  async resolve(threadId: string, actorId: string): Promise<{ id: string; status: ThreadStatus }> {
    const thread = await this.prisma.communicationThread.findUnique({ where: { id: threadId }, select: { status: true } });
    if (!thread) throw new NotFoundException('Communication thread not found.');
    if (thread.status === ThreadStatus.RESOLVED) {
      return { id: threadId, status: ThreadStatus.RESOLVED };
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.communicationThread.update({ where: { id: threadId }, data: { status: ThreadStatus.RESOLVED } });
      await this.audit.record(
        {
          actorType: ActorType.USER,
          actorId,
          eventKey: COMMUNICATION_AUDIT_EVENT.THREAD_RESOLVED,
          subjectType: 'CommunicationThread',
          subjectId: threadId,
        },
        tx,
      );
    });
    return { id: threadId, status: ThreadStatus.RESOLVED };
  }
}
