import { BillingFrequency, RenewalCaseStatus } from '../../generated/prisma/enums';
import {
  cycleStartDate,
  INITIAL_REMINDER_MILESTONES,
  isEffectiveHold,
  isReminderEligible,
} from './renewal-policy';

describe('renewal policy', () => {
  it('defines exactly the six approved renewal milestones', () => {
    expect(INITIAL_REMINDER_MILESTONES).toEqual([30, 21, 14, 7, 2, 0]);
  });

  it.each([
    RenewalCaseStatus.UPCOMING,
    RenewalCaseStatus.REMINDER_CYCLE,
    RenewalCaseStatus.AWAITING_CUSTOMER,
  ])('allows reminders in %s', (status) => expect(isReminderEligible(status)).toBe(true));

  it.each([
    RenewalCaseStatus.HUMAN_REVIEW,
    RenewalCaseStatus.ACCEPTED,
    RenewalCaseStatus.REJECTED,
    RenewalCaseStatus.INVOICE_DRAFT,
    RenewalCaseStatus.COLLECTING,
    RenewalCaseStatus.FULFILLED,
    RenewalCaseStatus.RETENTION,
    RenewalCaseStatus.SUSPENDED,
  ])('blocks reminders in %s', (status) => expect(isReminderEligible(status)).toBe(false));

  it('treats released and expired holds as ineffective', () => {
    const now = new Date('2026-08-24T10:00:00Z');
    expect(isEffectiveHold({ active: false, expiresAt: null }, now)).toBe(false);
    expect(
      isEffectiveHold({ active: true, expiresAt: new Date('2026-08-24T09:00:00Z') }, now),
    ).toBe(false);
    expect(
      isEffectiveHold({ active: true, expiresAt: new Date('2026-08-24T11:00:00Z') }, now),
    ).toBe(true);
  });

  it('calculates a stable cycle start without preceding the subscription start', () => {
    expect(
      cycleStartDate(
        new Date('2026-01-01T00:00:00Z'),
        new Date('2027-01-01T00:00:00Z'),
        BillingFrequency.ANNUAL,
      ),
    ).toEqual(new Date('2026-01-01T00:00:00Z'));
  });
});
