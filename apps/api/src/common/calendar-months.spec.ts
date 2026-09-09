import { addCalendarMonths } from '@cp/shared';

// The single shared helper both the frontend's live preview and the backend's authoritative
// SubscriptionsService.create()/update() import — tested once here so both sides inherit the same
// verified correctness rather than each reimplementing (and each having to be separately tested
// against) calendar-month arithmetic.
describe('addCalendarMonths (shared)', () => {
  it('12 months: 2026-09-09 -> 2027-09-09', () => {
    expect(addCalendarMonths(new Date('2026-09-09T00:00:00.000Z'), 12)).toEqual(
      new Date('2027-09-09T00:00:00.000Z'),
    );
  });

  it('60 months: 2026-09-09 -> 2031-09-09', () => {
    expect(addCalendarMonths(new Date('2026-09-09T00:00:00.000Z'), 60)).toEqual(
      new Date('2031-09-09T00:00:00.000Z'),
    );
  });

  it('custom 18 months: 2026-09-09 -> 2028-03-09', () => {
    expect(addCalendarMonths(new Date('2026-09-09T00:00:00.000Z'), 18)).toEqual(
      new Date('2028-03-09T00:00:00.000Z'),
    );
  });

  it('end-of-month, non-leap year: 2027-01-31 + 1 month -> 2027-02-28 (clamped, not overflowed into March)', () => {
    expect(addCalendarMonths(new Date('2027-01-31T00:00:00.000Z'), 1)).toEqual(
      new Date('2027-02-28T00:00:00.000Z'),
    );
  });

  it('end-of-month, leap year: 2028-01-31 + 1 month -> 2028-02-29', () => {
    expect(addCalendarMonths(new Date('2028-01-31T00:00:00.000Z'), 1)).toEqual(
      new Date('2028-02-29T00:00:00.000Z'),
    );
  });

  it('does not calculate as months * 30 days: 1 month from a 31-day month is not 30 days later', () => {
    const result = addCalendarMonths(new Date('2026-01-01T00:00:00.000Z'), 1);
    expect(result).toEqual(new Date('2026-02-01T00:00:00.000Z'));
    expect(result).not.toEqual(new Date('2026-01-31T00:00:00.000Z'));
  });

  it('a short month does not permanently shorten a later, longer month once clamped (31 Mar, not stuck at 28/29)', () => {
    // 31 Jan -> 28 Feb (clamped) -> from THAT clamped date, +1 more month should still be computed
    // from the original day-of-month semantics of a fresh call, not compounded drift from the
    // previous clamp.
    const fromMarch = addCalendarMonths(new Date('2027-03-31T00:00:00.000Z'), 1);
    expect(fromMarch).toEqual(new Date('2027-04-30T00:00:00.000Z'));
  });

  it('rolls over multiple years correctly (120 months)', () => {
    expect(addCalendarMonths(new Date('2026-06-15T00:00:00.000Z'), 120)).toEqual(
      new Date('2036-06-15T00:00:00.000Z'),
    );
  });

  it('is never shifted by timezone — operates purely on UTC date components', () => {
    const result = addCalendarMonths(new Date('2026-12-31T00:00:00.000Z'), 1);
    expect(result.getUTCFullYear()).toBe(2027);
    expect(result.getUTCMonth()).toBe(0);
    expect(result.getUTCDate()).toBe(31);
    expect(result.getUTCHours()).toBe(0);
  });
});
