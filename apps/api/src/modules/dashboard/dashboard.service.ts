import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import {
  CommunicationOutboxStatus,
  CustomerStatus,
  LegacyImportRowStatus,
  RenewalCaseStatus,
  SubscriptionStatus,
} from '../../generated/prisma/enums';
import { BusinessTimeService } from '../../time/business-time.service';
import { ClockService } from '../../time/clock.service';

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
    private readonly businessTime: BusinessTimeService,
  ) {}

  async summary() {
    const now = this.clock.now();
    const today = this.businessTime.businessDate(now);
    const renewalCount = (days: number) =>
      this.prisma.subscription.count({
        where: {
          status: SubscriptionStatus.ACTIVE,
          renewalDate: { gte: today, lte: this.businessTime.addBusinessDays(now, days) },
        },
      });
    const stuckBefore = new Date(now.getTime() - 15 * 60 * 1_000);
    const [
      activeCustomers,
      totalSubscriptions,
      serviceGroups,
      within30,
      within21,
      within14,
      within7,
      within2,
      expiresToday,
      awaitingCustomer,
      renewalCasesOnHold,
      queuedReminders,
      failedOrStuckOutbox,
      awaitingLegacyReview,
      activeTechnicalConnections,
    ] = await Promise.all([
      this.prisma.customer.count({ where: { status: CustomerStatus.ACTIVE } }),
      this.prisma.subscription.count(),
      this.prisma.subscription.groupBy({
        by: ['serviceTypeId'],
        where: { status: SubscriptionStatus.ACTIVE },
        _count: { _all: true },
      }),
      renewalCount(30),
      renewalCount(21),
      renewalCount(14),
      renewalCount(7),
      renewalCount(2),
      this.prisma.subscription.count({
        where: { status: SubscriptionStatus.ACTIVE, renewalDate: today },
      }),
      this.prisma.renewalCase.count({ where: { status: RenewalCaseStatus.AWAITING_CUSTOMER } }),
      this.prisma.renewalCase.count({
        where: {
          holds: {
            some: { active: true, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
          },
        },
      }),
      this.prisma.communicationOutbox.count({
        where: { status: CommunicationOutboxStatus.QUEUED },
      }),
      this.prisma.communicationOutbox.count({
        where: {
          OR: [
            { status: CommunicationOutboxStatus.FAILED },
            { status: CommunicationOutboxStatus.PROCESSING, updatedAt: { lt: stuckBefore } },
          ],
        },
      }),
      this.prisma.legacyImportRow.count({
        where: {
          status: {
            in: [
              LegacyImportRowStatus.STAGED,
              LegacyImportRowStatus.REQUIRES_MANUAL_REVIEW,
              LegacyImportRowStatus.READY_FOR_APPROVAL,
            ],
          },
        },
      }),
      this.prisma.technicalConnection.count({ where: { enabled: true } }),
    ]);
    const serviceTypes = await this.prisma.serviceType.findMany({
      where: { id: { in: serviceGroups.map((group) => group.serviceTypeId) } },
      select: { id: true, code: true, name: true },
    });
    const serviceTypeById = new Map(
      serviceTypes.map((serviceType) => [serviceType.id, serviceType]),
    );
    return {
      activeCustomers,
      totalSubscriptions,
      upcomingRenewals30Days: within30,
      renewalWindows: { within30, within21, within14, within7, within2, expiresToday },
      awaitingCustomer,
      renewalCasesOnHold,
      queuedReminders,
      failedOrStuckOutbox,
      awaitingLegacyReview,
      activeTechnicalConnections,
      subscriptionsByServiceType: serviceGroups.map((group) => ({
        serviceType: serviceTypeById.get(group.serviceTypeId),
        count: group._count._all,
      })),
      businessTimezone: this.businessTime.timezone,
      businessDate: this.businessTime.businessDateKey(now),
      asOf: now.toISOString(),
    };
  }
}
