import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { addCalendarMonths } from '@cp/shared';
import { AuditService } from '../../audit/audit.service';
import type { MutationContext } from '../../common/mutation-context';
import { pageMetadata } from '../../common/page-query.dto';
import { throwMappedPrismaError } from '../../common/prisma-errors';
import { PrismaService } from '../../database/prisma.service';
import { ActorType } from '../../generated/prisma/enums';
import { SubscriptionCodeService } from './subscription-code.service';
import type {
  CreateSubscriptionDto,
  SubscriptionListQueryDto,
  UpdateSubscriptionDto,
} from './subscriptions.dto';

const subscriptionInclude = {
  customer: {
    select: { id: true, customerCode: true, nameEn: true, nameAr: true, status: true },
  },
  currencyDefinition: true,
  serviceType: { select: { id: true, code: true, name: true, active: true } },
  servicePackage: { include: { terms: { orderBy: { termMonths: 'asc' as const } } } },
  identifiers: { orderBy: { createdAt: 'asc' as const } },
  connections: {
    include: {
      technicalConnection: {
        select: { id: true, code: true, name: true, type: true, enabled: true },
      },
    },
    orderBy: { createdAt: 'asc' as const },
  },
} as const;

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly subscriptionCode: SubscriptionCodeService,
  ) {}

  async list(query: SubscriptionListQueryDto) {
    const search = query.search?.trim();
    const where = {
      customerId: query.customerId,
      serviceTypeId: query.serviceTypeId,
      servicePackageId: query.servicePackageId,
      currency: query.currency,
      status: query.status,
      renewalDate:
        query.renewalFrom || query.renewalTo
          ? {
              gte: query.renewalFrom ? new Date(query.renewalFrom) : undefined,
              lte: query.renewalTo ? new Date(query.renewalTo) : undefined,
            }
          : undefined,
      ...(query.billingEntityId ? { customer: { billingEntityId: query.billingEntityId } } : {}),
      // No `mode: 'insensitive'` here: that filter is Postgres/MongoDB-only and Prisma throws a
      // validation error for it against a mysql datasource. MariaDB's utf8mb4_unicode_ci columns
      // are already case-insensitive by collation, so a plain `contains` is sufficient.
      ...(search
        ? {
            OR: [
              { subscriptionCode: { contains: search } },
              { name: { contains: search } },
              { customer: { nameEn: { contains: search } } },
              { customer: { nameAr: { contains: search } } },
            ],
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.subscription.findMany({
        where,
        include: subscriptionInclude,
        orderBy: [{ renewalDate: 'asc' }, { subscriptionCode: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.subscription.count({ where }),
    ]);
    return {
      data: data.map((item) => this.withCurrentJod(item)),
      meta: pageMetadata(total, query.page, query.pageSize),
    };
  }

  async findOne(id: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id },
      include: subscriptionInclude,
    });
    if (!subscription) throw new NotFoundException('Subscription not found.');
    return this.withCurrentJod(subscription);
  }

  async create(input: CreateSubscriptionDto, context: MutationContext) {
    // The canonical Renewal Date for a NEW subscription is always derived here, server-side, from
    // Start Date + Renewal Interval (calendar-month arithmetic) — never accepted from the caller
    // (see the comment on CreateSubscriptionDto). Since renewalIntervalMonths is required and
    // @Min(1)-validated, the result is always strictly after startDate — no separate
    // after-start-date check is needed the way update() needs one.
    const startDate = new Date(input.startDate);
    const renewalDate = addCalendarMonths(startDate, input.renewalIntervalMonths);
    const servicePackage = await this.requireParents(
      input.customerId,
      input.serviceTypeId,
      input.servicePackageId,
    );
    const currencyDefinition = await this.requireCurrency(input.currency);
    const { identifiers, ...subscriptionInput } = input;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const subscriptionCode = await this.subscriptionCode.next(tx, input.customerId);
        const subscription = await tx.subscription.create({
          data: {
            ...subscriptionInput,
            subscriptionCode,
            exchangeRateToJod: currencyDefinition.rateToJod,
            sellingPriceJod: currencyDefinition
              .rateToJod!.mul(input.sellingPrice)
              .toDecimalPlaces(3),
            exchangeRateEffectiveDate: currencyDefinition.effectiveDate,
            startDate,
            renewalDate,
            // Transitional mapping (Phase 2.2): `renewalDate` remains the field the renewal
            // engine reads; `currentTermEndDate` is the new, unambiguous name for the same
            // "when does the current term end" concept and is kept in lockstep here.
            currentTermEndDate: renewalDate,
            packageNameSnapshot: servicePackage?.name,
            packageSpecificationsSnapshot: servicePackage?.specifications ?? undefined,
            customPackage: servicePackage?.kind === 'CUSTOM_TEMPLATE',
            classificationStatus: servicePackage
              ? servicePackage.kind === 'CUSTOM_TEMPLATE'
                ? 'CUSTOM'
                : 'MATCHED_OFFICIAL'
              : 'UNCLASSIFIED',
            classificationEvidence: servicePackage
              ? { selectedByUser: context.actorId, packageCode: servicePackage.code }
              : undefined,
            identifiers: identifiers?.length ? { create: identifiers } : undefined,
          },
          include: subscriptionInclude,
        });
        await this.audit.record(
          {
            actorType: ActorType.USER,
            actorId: context.actorId,
            eventKey: 'subscription.created',
            subjectType: 'Subscription',
            subjectId: subscription.id,
            newState: subscription,
            ipAddress: context.ipAddress,
          },
          tx,
        );
        return this.withCurrentJod(subscription);
      });
    } catch (error) {
      throwMappedPrismaError(error);
    }
  }

  async update(id: string, input: UpdateSubscriptionDto, context: MutationContext) {
    const oldState = await this.findOne(id);

    // Renewal Date handling. "Modern" means an effective Renewal Interval is on record — either
    // the request is setting one now, or the existing row already has one; "legacy" means it is
    // (and remains) null, i.e. a historical subscription that predates this concept.
    //
    //   modern    + explicit renewalDate                -> REJECTED (BadRequestException). The
    //               interval already defines the one correct value; a caller must never be able to
    //               silently or explicitly override it with an unrelated date. This is an explicit
    //               contract, not a silent discard — the request fails outright rather than having
    //               its renewalDate quietly ignored.
    //   modern    + Start Date and/or Renewal Interval change (no renewalDate)  -> DERIVED.
    //   modern    + neither of the above (e.g. only price changes)             -> UNTOUCHED.
    //   legacy    + explicit renewalDate  -> accepted as-is (a direct historical correction —
    //               there is no interval to derive a canonical value from in the first place).
    //   legacy    + no explicit renewalDate -> UNTOUCHED, same as modern.
    //
    // `effectiveIntervalMonths == null` (nullish, not falsy) is deliberate: a stored/effective
    // interval of `0` is not a valid interval, but it is also not "no interval" — it must not be
    // treated as legacy just because it is falsy.
    const startDateChanged = input.startDate !== undefined;
    const intervalChanged = input.renewalIntervalMonths !== undefined;
    const effectiveIntervalMonths = intervalChanged
      ? input.renewalIntervalMonths
      : oldState.renewalIntervalMonths;
    const isModern = effectiveIntervalMonths != null;

    if (isModern && input.renewalDate !== undefined) {
      throw new BadRequestException(
        'Renewal Date cannot be set directly for a subscription with a Renewal Interval. Change Start Date or Renewal Interval instead — Renewal Date is derived automatically.',
      );
    }

    let renewalDate: Date | undefined;
    if (isModern) {
      if (startDateChanged || intervalChanged) {
        const effectiveStartDate = input.startDate ? new Date(input.startDate) : oldState.startDate;
        renewalDate = addCalendarMonths(effectiveStartDate, effectiveIntervalMonths);
      }
    } else if (input.renewalDate) {
      renewalDate = new Date(input.renewalDate);
    }
    // Validate the FINAL effective combination, not just what changed — this catches the case
    // where Start Date moves alone with no interval available to recompute from and no explicit
    // renewalDate supplied either, which could otherwise silently leave Start Date on/after the
    // untouched old Renewal Date.
    const finalStartDate = input.startDate ? new Date(input.startDate) : oldState.startDate;
    const finalRenewalDate = renewalDate ?? oldState.renewalDate;
    this.validateDates(finalStartDate.toISOString(), finalRenewalDate.toISOString());

    const parentChanged = input.serviceTypeId || input.servicePackageId;
    const servicePackage = parentChanged
      ? await this.requireParents(
          oldState.customerId,
          input.serviceTypeId ?? oldState.serviceTypeId,
          input.servicePackageId ?? oldState.servicePackageId ?? undefined,
        )
      : oldState.servicePackage;
    const priceChanged = input.sellingPrice !== undefined || input.currency !== undefined;
    const currencyDefinition = priceChanged
      ? await this.requireCurrency(input.currency ?? oldState.currency)
      : null;
    const sellingPrice = input.sellingPrice ?? oldState.sellingPrice.toString();
    const { identifiers, ...subscriptionInput } = input;
    const data = {
      ...subscriptionInput,
      exchangeRateToJod: currencyDefinition?.rateToJod,
      sellingPriceJod: currencyDefinition?.rateToJod?.mul(sellingPrice).toDecimalPlaces(3),
      exchangeRateEffectiveDate: currencyDefinition?.effectiveDate,
      startDate: input.startDate ? new Date(input.startDate) : undefined,
      renewalDate,
      currentTermEndDate: renewalDate,
      packageNameSnapshot: input.servicePackageId ? servicePackage?.name : undefined,
      packageSpecificationsSnapshot: input.servicePackageId
        ? (servicePackage?.specifications ?? undefined)
        : undefined,
      customPackage: input.servicePackageId
        ? servicePackage?.kind === 'CUSTOM_TEMPLATE'
        : undefined,
      classificationStatus: input.servicePackageId
        ? servicePackage?.kind === 'CUSTOM_TEMPLATE'
          ? ('CUSTOM' as const)
          : ('MATCHED_OFFICIAL' as const)
        : undefined,
      classificationEvidence: input.servicePackageId
        ? { selectedByUser: context.actorId, packageCode: servicePackage?.code }
        : undefined,
      identifiers: identifiers ? { deleteMany: {}, create: identifiers } : undefined,
    };
    try {
      return await this.prisma.$transaction(async (tx) => {
        const subscription = await tx.subscription.update({
          where: { id },
          data,
          include: subscriptionInclude,
        });
        await this.audit.record(
          {
            actorType: ActorType.USER,
            actorId: context.actorId,
            eventKey: 'subscription.updated',
            subjectType: 'Subscription',
            subjectId: subscription.id,
            oldState,
            newState: subscription,
            ipAddress: context.ipAddress,
          },
          tx,
        );
        return this.withCurrentJod(subscription);
      });
    } catch (error) {
      throwMappedPrismaError(error);
    }
  }

  private withCurrentJod<
    T extends {
      sellingPrice: { toString(): string };
      currencyDefinition: {
        rateToJod: {
          mul(value: string): { toDecimalPlaces(decimalPlaces: number): unknown };
        } | null;
        effectiveDate: Date | null;
      };
    },
  >(subscription: T) {
    const currentRate = subscription.currencyDefinition.rateToJod;
    return {
      ...subscription,
      currentExchangeRateToJod: currentRate,
      currentExchangeRateEffectiveDate: subscription.currencyDefinition.effectiveDate,
      currentSellingPriceJod: currentRate
        ? currentRate.mul(subscription.sellingPrice.toString()).toDecimalPlaces(3)
        : null,
    };
  }

  private async requireCurrency(code: string) {
    const currency = await this.prisma.currency.findUnique({
      where: { code: code.trim().toUpperCase() },
    });
    if (!currency?.active || !currency.rateToJod || !currency.effectiveDate) {
      throw new BadRequestException(
        'Select an active currency with a configured JOD exchange rate.',
      );
    }
    return currency;
  }

  private validateDates(startDate: string, renewalDate: string): void {
    if (new Date(startDate) >= new Date(renewalDate)) {
      throw new BadRequestException('Renewal date must be after start date.');
    }
  }

  private async requireParents(
    customerId: string,
    serviceTypeId: string,
    servicePackageId?: string,
  ) {
    const [customer, serviceType, servicePackage] = await Promise.all([
      this.prisma.customer.findUnique({ where: { id: customerId }, select: { status: true } }),
      this.prisma.serviceType.findUnique({
        where: { id: serviceTypeId },
        select: { active: true },
      }),
      servicePackageId
        ? this.prisma.servicePackage.findUnique({
            where: { id: servicePackageId },
            select: {
              id: true,
              code: true,
              name: true,
              kind: true,
              specifications: true,
              serviceTypeId: true,
              active: true,
            },
          })
        : null,
    ]);
    if (!customer) throw new BadRequestException('Customer does not exist.');
    if (!serviceType?.active) throw new BadRequestException('An active Service Type is required.');
    if (
      servicePackageId &&
      (!servicePackage?.active || servicePackage.serviceTypeId !== serviceTypeId)
    ) {
      throw new BadRequestException('Select an active package belonging to the Service Type.');
    }
    return servicePackage;
  }
}
