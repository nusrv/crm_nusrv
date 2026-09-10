import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../../audit/audit.service';
import type { MutationContext } from '../../common/mutation-context';
import { pageMetadata } from '../../common/page-query.dto';
import { PrismaService } from '../../database/prisma.service';
import { ActorType, CustomerDecision, RenewalCaseStatus } from '../../generated/prisma/enums';
import { BusinessTimeService } from '../../time/business-time.service';
import { ClockService } from '../../time/clock.service';
import {
  CreateRenewalHoldDto,
  RenewalCaseListQueryDto,
  RenewalHoldFilter,
} from './renewal-cases.dto';
import { assertLegalRenewalCaseTransition } from './renewal-transition-policy';

// Resolved/dead-end states: a case here is no longer "in flight", so manual workflow actions
// (mark awaiting customer / accepted / do-not-renew / fulfilled) refuse to fire from any of them,
// and the Renewals overview's due/overdue counts exclude them regardless of their dueDate.
const TERMINAL_STATUSES: RenewalCaseStatus[] = [
  RenewalCaseStatus.CLOSED,
  RenewalCaseStatus.FULFILLED,
  RenewalCaseStatus.REJECTED,
  RenewalCaseStatus.DO_NOT_RENEW,
];

const renewalCaseInclude = {
  subscription: {
    include: {
      customer: {
        select: {
          id: true,
          customerCode: true,
          nameEn: true,
          nameAr: true,
          contactName: true,
          primaryEmail: true,
          phone: true,
          billingEntity: { select: { id: true, code: true, name: true } },
        },
      },
      serviceType: { select: { id: true, code: true, name: true } },
      servicePackage: { select: { id: true, name: true } },
    },
  },
  holds: { orderBy: { createdAt: 'desc' as const } },
  // Cheap operational signal for the list view (bounded to one extra row per case, no N+1):
  // the single most recent outbox message tells us "not sent / queued / delivered / failed"
  // without pulling the full history, which the detail view fetches separately.
  communicationOutbox: {
    orderBy: { queuedAt: 'desc' as const },
    take: 1,
    select: { status: true, queuedAt: true, audience: true },
  },
  _count: { select: { communicationOutbox: true } },
} as const;

@Injectable()
export class RenewalCasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clock: ClockService,
    private readonly businessTime: BusinessTimeService,
  ) {}

  async list(query: RenewalCaseListQueryDto) {
    const now = this.clock.now();
    const search = query.search?.trim();
    const activeHold = {
      active: true,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    };
    const dueDate =
      query.daysBeforeDue !== undefined
        ? this.businessTime.addBusinessDays(now, query.daysBeforeDue)
        : query.dueFrom || query.dueTo
          ? {
              gte: query.dueFrom ? new Date(query.dueFrom) : undefined,
              lte: query.dueTo ? new Date(query.dueTo) : undefined,
            }
          : undefined;
    const where = {
      dueDate,
      status: query.status,
      subscription: {
        customerId: query.customerId,
        serviceTypeId: query.serviceTypeId,
        servicePackageId: query.servicePackageId,
        ...(query.billingEntityId ? { customer: { billingEntityId: query.billingEntityId } } : {}),
        // No `mode: 'insensitive'` here: that filter is Postgres/MongoDB-only and Prisma throws a
        // validation error for it against a mysql datasource. MariaDB's utf8mb4_unicode_ci
        // columns are already case-insensitive by collation, so a plain `contains` is sufficient.
        ...(search
          ? {
              OR: [
                { subscriptionCode: { contains: search } },
                { name: { contains: search } },
                { customer: { nameEn: { contains: search } } },
                { customer: { nameAr: { contains: search } } },
                { customer: { customerCode: { contains: search } } },
              ],
            }
          : {}),
      },
      holds:
        query.holdStatus === RenewalHoldFilter.ACTIVE
          ? { some: activeHold }
          : query.holdStatus === RenewalHoldFilter.NONE
            ? { none: activeHold }
            : undefined,
    };
    const [data, total] = await Promise.all([
      this.prisma.renewalCase.findMany({
        where,
        include: renewalCaseInclude,
        orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.renewalCase.count({ where }),
    ]);
    return { data, meta: pageMetadata(total, query.page, query.pageSize), asOf: now.toISOString() };
  }

  /**
   * Overview counts for the Renewals page's summary cards. Deliberately independent of the
   * table's own filters — this reflects the overall renewal-case landscape, not the current
   * search/status selection, the same way a dashboard header would. Excludes resolved/dead-end
   * cases (see TERMINAL_STATUSES) from the due/overdue buckets: a FULFILLED or DO_NOT_RENEW case
   * is no longer "due" in an operational sense no matter what its stored dueDate says.
   */
  async summary() {
    const now = this.clock.now();
    const today = this.businessTime.businessDate(now);
    const in7Days = this.businessTime.addBusinessDays(now, 7);
    const in30Days = this.businessTime.addBusinessDays(now, 30);
    const activeHold = {
      active: true,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    };
    const notTerminal = { status: { notIn: TERMINAL_STATUSES } };
    const [dueWithin7Days, dueWithin30Days, overdue, awaitingCustomer, onHold] = await Promise.all([
      this.prisma.renewalCase.count({
        where: { ...notTerminal, dueDate: { gte: today, lte: in7Days } },
      }),
      this.prisma.renewalCase.count({
        where: { ...notTerminal, dueDate: { gte: today, lte: in30Days } },
      }),
      this.prisma.renewalCase.count({
        where: { ...notTerminal, dueDate: { lt: today } },
      }),
      this.prisma.renewalCase.count({
        where: { status: RenewalCaseStatus.AWAITING_CUSTOMER },
      }),
      this.prisma.renewalCase.count({ where: { holds: { some: activeHold } } }),
    ]);
    return { dueWithin7Days, dueWithin30Days, overdue, awaitingCustomer, onHold };
  }

  async findOne(id: string) {
    const record = await this.prisma.renewalCase.findUnique({
      where: { id },
      include: {
        ...renewalCaseInclude,
        communicationOutbox: { orderBy: { queuedAt: 'desc' }, take: 100 },
        evaluationDecisions: { orderBy: { createdAt: 'desc' }, take: 100 },
      },
    });
    if (!record) throw new NotFoundException('Renewal Case not found.');
    return record;
  }

  async createHold(id: string, input: CreateRenewalHoldDto, context: MutationContext) {
    const renewalCase = await this.prisma.renewalCase.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!renewalCase) throw new NotFoundException('Renewal Case not found.');
    const reason = input.reason.trim();
    if (reason.length < 3) throw new BadRequestException('Hold reason is required.');
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    if (expiresAt && expiresAt <= this.clock.now()) {
      throw new BadRequestException('Hold expiration must be in the future.');
    }
    return this.prisma.$transaction(async (tx) => {
      const hold = await tx.renewalHold.create({
        data: {
          renewalCaseId: id,
          reason,
          stopsCustomerReminders: input.stopsCustomerReminders,
          stopsInternalNotifications: input.stopsInternalNotifications,
          expiresAt,
          createdById: context.actorId,
        },
      });
      await this.audit.record(
        {
          actorType: ActorType.USER,
          actorId: context.actorId,
          eventKey: 'renewal.hold.created',
          subjectType: 'RenewalHold',
          subjectId: hold.id,
          newState: hold,
          metadata: { renewalCaseId: id },
          ipAddress: context.ipAddress,
        },
        tx,
      );
      return hold;
    });
  }

  async releaseHold(caseId: string, holdId: string, context: MutationContext) {
    const oldState = await this.prisma.renewalHold.findFirst({
      where: { id: holdId, renewalCaseId: caseId },
    });
    if (!oldState) throw new NotFoundException('Renewal hold not found.');
    if (!oldState.active) throw new ConflictException('Renewal hold is already released.');
    return this.prisma.$transaction(async (tx) => {
      const hold = await tx.renewalHold.update({
        where: { id: holdId },
        data: { active: false, releasedById: context.actorId, releasedAt: this.clock.now() },
      });
      await this.audit.record(
        {
          actorType: ActorType.USER,
          actorId: context.actorId,
          eventKey: 'renewal.hold.released',
          subjectType: 'RenewalHold',
          subjectId: hold.id,
          oldState,
          newState: hold,
          metadata: { renewalCaseId: caseId },
          ipAddress: context.ipAddress,
        },
        tx,
      );
      return hold;
    });
  }

  // Four intentional, single-purpose business actions — not a generic status editor. Each only
  // fires from a non-terminal state (see TERMINAL_STATUSES) and sets the one matching timestamp
  // field the schema already has for that decision (acceptedAt / doNotRenewAt / fulfilledAt),
  // exactly like createHold/releaseHold above set their own dedicated fields. Phase 3's
  // invoice/payment/collection states are deliberately not exposed here — that workflow remains
  // locked and unbuilt; these four are the ones the current Phase 2 domain model already supports.

  async markAwaitingCustomer(id: string, context: MutationContext) {
    return this.transitionStatus(
      id,
      RenewalCaseStatus.AWAITING_CUSTOMER,
      {},
      'renewal.case.marked_awaiting_customer',
      context,
    );
  }

  async markAccepted(id: string, context: MutationContext) {
    return this.transitionStatus(
      id,
      RenewalCaseStatus.ACCEPTED,
      { customerDecision: CustomerDecision.ACCEPTED, acceptedAt: this.clock.now() },
      'renewal.case.marked_accepted',
      context,
    );
  }

  async markDoNotRenew(id: string, context: MutationContext) {
    return this.transitionStatus(
      id,
      RenewalCaseStatus.DO_NOT_RENEW,
      { customerDecision: CustomerDecision.REJECTED, doNotRenewAt: this.clock.now() },
      'renewal.case.marked_do_not_renew',
      context,
    );
  }

  async markFulfilled(id: string, context: MutationContext) {
    return this.transitionStatus(
      id,
      RenewalCaseStatus.FULFILLED,
      { fulfilledAt: this.clock.now() },
      'renewal.case.marked_fulfilled',
      context,
    );
  }

  private async transitionStatus(
    id: string,
    status: RenewalCaseStatus,
    extraData: Record<string, unknown>,
    eventKey: string,
    context: MutationContext,
  ) {
    // Fast pre-check against a plain read: gives a precise, immediate rejection for a genuinely
    // illegal transition (wrong role of caller aside — e.g. ACCEPTED -> AWAITING_CUSTOMER) without
    // even opening a transaction. This is NOT what makes concurrent transitions safe — that is the
    // compare-and-swap write below, which re-checks the status atomically at the database level
    // using whatever the row's status actually is at write time, not this pre-check's snapshot.
    const current = await this.prisma.renewalCase.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Renewal Case not found.');
    if (TERMINAL_STATUSES.includes(current.status)) {
      throw new ConflictException(
        `Renewal Case is already ${current.status} and cannot be moved to ${status}.`,
      );
    }
    assertLegalRenewalCaseTransition(current.status, status);

    return this.prisma.$transaction(async (tx) => {
      // Compare-and-swap: the WHERE clause re-checks status at the moment of the write, not at the
      // moment of the read above. If another request already moved this case away from
      // `current.status` since we read it, this affects 0 rows and we report a clear conflict
      // instead of silently overwriting whatever the other request just wrote (last-write-wins).
      const result = await tx.renewalCase.updateMany({
        where: { id, status: current.status },
        data: { status, ...extraData },
      });
      if (result.count === 0) {
        const latest = await tx.renewalCase.findUnique({ where: { id } });
        throw new ConflictException(
          `Renewal Case status changed concurrently (now ${latest?.status ?? 'unknown'}); the requested transition to ${status} was not applied. Reload and try again.`,
        );
      }
      // Re-fetch to get the row as it now stands for the response/audit `newState` — updateMany
      // does not return the updated row itself. Since the CAS above only succeeds when the row's
      // status still matched `current.status` at write time, `current` is guaranteed accurate as
      // the audited `oldState` for this specific successful transition, not a stale pre-race value.
      const renewalCase = await tx.renewalCase.findUniqueOrThrow({ where: { id } });
      await this.audit.record(
        {
          actorType: ActorType.USER,
          actorId: context.actorId,
          eventKey,
          subjectType: 'RenewalCase',
          subjectId: id,
          oldState: current,
          newState: renewalCase,
          ipAddress: context.ipAddress,
        },
        tx,
      );
      return renewalCase;
    });
  }
}
