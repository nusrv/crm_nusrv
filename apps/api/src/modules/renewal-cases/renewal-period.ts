import { BadRequestException } from '@nestjs/common';
/** Calendar-month arithmetic clamps month ends, preserving leap years. Dates are UTC date-only. */
export function proposedRenewalPeriod(dueDate: Date, months: number | null) {
 if (!months || !Number.isInteger(months) || months < 1 || months > 1200)
   throw new BadRequestException('Configure a valid renewal interval in months before accepting.');
 const start = new Date(dueDate);
 const next = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + months, 1));
 const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
 next.setUTCDate(Math.min(start.getUTCDate(), lastDay));
 return { proposedPeriodStart: start, proposedPeriodEnd: new Date(next.getTime() - 86400000), proposedNextRenewalDate: next };
}
