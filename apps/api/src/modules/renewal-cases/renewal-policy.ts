import { BillingFrequency, RenewalCaseStatus } from '../../generated/prisma/enums';

export const INITIAL_REMINDER_MILESTONES = [30, 21, 14, 7, 2, 0] as const;

export const REMINDER_ELIGIBLE_STATUSES = new Set<RenewalCaseStatus>([
  RenewalCaseStatus.UPCOMING,
  RenewalCaseStatus.REMINDER_CYCLE,
  RenewalCaseStatus.AWAITING_CUSTOMER,
]);

export function isReminderEligible(status: RenewalCaseStatus): boolean {
  return REMINDER_ELIGIBLE_STATUSES.has(status);
}

export function isEffectiveHold(
  hold: { active: boolean; expiresAt: Date | null },
  asOf: Date,
): boolean {
  return hold.active && (!hold.expiresAt || hold.expiresAt > asOf);
}

export interface EffectiveHoldPolicy {
  effectiveHoldIds: string[];
  customerReminderHoldIds: string[];
  internalNotificationHoldIds: string[];
  stopCustomerReminders: boolean;
  stopInternalNotifications: boolean;
}

export function aggregateEffectiveHolds(
  holds: Array<{
    id: string;
    active: boolean;
    expiresAt: Date | null;
    stopsCustomerReminders: boolean;
    stopsInternalNotifications: boolean;
  }>,
  asOf: Date,
): EffectiveHoldPolicy {
  const effectiveHolds = holds.filter((hold) => isEffectiveHold(hold, asOf));
  return {
    effectiveHoldIds: effectiveHolds.map((hold) => hold.id).sort(),
    customerReminderHoldIds: effectiveHolds
      .filter((hold) => hold.stopsCustomerReminders)
      .map((hold) => hold.id)
      .sort(),
    internalNotificationHoldIds: effectiveHolds
      .filter((hold) => hold.stopsInternalNotifications)
      .map((hold) => hold.id)
      .sort(),
    stopCustomerReminders: effectiveHolds.some((hold) => hold.stopsCustomerReminders),
    stopInternalNotifications: effectiveHolds.some((hold) => hold.stopsInternalNotifications),
  };
}

export function cycleStartDate(
  startDate: Date,
  dueDate: Date,
  billingFrequency: BillingFrequency,
  renewalIntervalMonths?: number | null,
): Date {
  const months =
    renewalIntervalMonths ??
    {
      [BillingFrequency.MONTHLY]: 1,
      [BillingFrequency.QUARTERLY]: 3,
      [BillingFrequency.SEMI_ANNUAL]: 6,
      [BillingFrequency.ANNUAL]: 12,
      [BillingFrequency.BIENNIAL]: 24,
      [BillingFrequency.CUSTOM]: 0,
    }[billingFrequency];
  if (!months) return startDate;
  const calculated = new Date(dueDate);
  calculated.setUTCMonth(calculated.getUTCMonth() - months);
  return calculated > startDate ? calculated : startDate;
}
