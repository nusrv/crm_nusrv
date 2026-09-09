// Client-side day-diffing for the Renewals page. Deliberately simple: it compares the calendar
// date portion of two ISO strings in UTC, the same way every other date cell in this app already
// displays dates (via `.slice(0, 10)`), rather than trying to replicate the backend's
// business-timezone-aware BusinessTimeService on the client. `asOf` should be the `asOf` value
// the /renewal-cases list response returns (the server's own "now"), not the browser's clock.

const DAY_MS = 86_400_000;

function toEpochDay(isoDateOrDateTime: string): number {
  return Math.floor(Date.parse(`${isoDateOrDateTime.slice(0, 10)}T00:00:00.000Z`) / DAY_MS);
}

export function daysUntilDue(dueDate: string, asOf: string): number {
  return toEpochDay(dueDate) - toEpochDay(asOf);
}

/** "6 days", "Today", "3 days overdue" — never a bare negative number. */
export function daysLeftLabel(days: number): string {
  if (days < 0) {
    const n = Math.abs(days);
    return `${n} day${n === 1 ? '' : 's'} overdue`;
  }
  if (days === 0) return 'Today';
  return `${days} day${days === 1 ? '' : 's'}`;
}

export type Urgency = 'overdue' | 'today' | 'week' | 'month' | 'later';

export function urgencyOf(days: number): Urgency {
  if (days < 0) return 'overdue';
  if (days === 0) return 'today';
  if (days <= 7) return 'week';
  if (days <= 30) return 'month';
  return 'later';
}

export const URGENCY_LABEL: Record<Urgency, string> = {
  overdue: 'Overdue',
  today: 'Due today',
  week: 'Due within 7 days',
  month: 'Due within 30 days',
  later: 'Later',
};

export interface LatestReminder {
  status: string;
  queuedAt: string;
  audience: string;
}

/**
 * A compact reminder-status label for the list view, derived from the single most recent
 * outbox message for a case (cheap — no full history fetch needed there; the detail view fetches
 * the full history separately). Deliberately doesn't claim a "queued count": only the latest
 * message's own status is reliably known this cheaply, so "Queued" stays unquantified rather than
 * showing a number that isn't actually a queued-only count.
 */
export function reminderStatusLabel(
  latest: LatestReminder | null | undefined,
  totalEverQueued: number,
): string {
  if (!totalEverQueued || !latest) return 'Not sent';
  switch (latest.status) {
    case 'DELIVERED':
      return `Last reminder: ${latest.queuedAt.slice(0, 10)}`;
    case 'FAILED':
      return 'Failed';
    case 'CANCELLED':
      return 'Cancelled';
    case 'QUEUED':
    case 'PROCESSING':
      return 'Queued';
    default:
      return 'Not sent';
  }
}
