export const ROLE_CODES = ['ADMIN', 'ACCOUNTANT', 'IT', 'SALES_DEVELOPMENT', 'MANAGEMENT'] as const;

export type RoleCode = (typeof ROLE_CODES)[number];

export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string;
  roles: RoleCode[];
}

export interface HealthComponent {
  status: 'up' | 'down';
}

export interface ReadinessResponse {
  status: 'ok' | 'degraded';
  services: {
    database: HealthComponent;
    redis: HealthComponent;
  };
}

/**
 * The single canonical calendar-month arithmetic used everywhere a Subscription's Renewal Date is
 * derived from its Start Date and Renewal Interval (frontend live preview, backend authoritative
 * calculation) — kept here specifically so both sides run the exact same code, not just the same
 * algorithm reimplemented twice.
 *
 * Calendar-month addition, not `months * 30 days`: adding N months keeps the same day-of-month
 * whenever that day exists in the target month, and otherwise clamps to the target month's actual
 * last day (e.g. 31 Jan + 1 month -> last day of Feb, never overflowing into March). All arithmetic
 * is done in UTC against a date-only value (this project's convention for date-only fields — see
 * `BusinessTimeService`), so it is never shifted by the caller's local timezone.
 */
export function addCalendarMonths(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  const targetMonthIndex = month + months;
  // Day 0 of the month after the target month is the target month's own last day — a standard,
  // reliable way to get a month's length that also lets `Date.UTC` normalize month/year overflow
  // (targetMonthIndex can be far outside 0-11, e.g. for a 60-month interval) for free.
  const daysInTargetMonth = new Date(Date.UTC(year, targetMonthIndex + 1, 0)).getUTCDate();
  const clampedDay = Math.min(day, daysInTargetMonth);
  return new Date(Date.UTC(year, targetMonthIndex, clampedDay));
}
