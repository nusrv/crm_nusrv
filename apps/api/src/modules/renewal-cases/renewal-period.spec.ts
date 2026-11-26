import { BadRequestException } from '@nestjs/common';
import { proposedRenewalPeriod } from './renewal-period';

function dates(due: string, months: number) {
  const proposal = proposedRenewalPeriod(new Date(due), months);
  return Object.fromEntries(
    Object.entries(proposal).map(([key, value]) => [key, value.toISOString().slice(0, 10)]),
  );
}

describe('P1 proposed renewal dates (OD-3 / OD-7)', () => {
  it('continues an ordinary yearly term without changing the current tracking date', () => {
    const current = new Date('2026-11-23');
    expect(dates('2026-11-23', 12)).toEqual({
      proposedPeriodStart: '2026-11-23',
      proposedPeriodEnd: '2027-11-22',
      proposedNextRenewalDate: '2027-11-23',
    });
    expect(current.toISOString().slice(0, 10)).toBe('2026-11-23');
  });

  it('clamps January 31 to February 28 and preserves the day before as the end', () => {
    expect(dates('2027-01-31', 1)).toEqual({
      proposedPeriodStart: '2027-01-31',
      proposedPeriodEnd: '2027-02-27',
      proposedNextRenewalDate: '2027-02-28',
    });
  });

  it('handles leap-year February and one-year rollover without timezone shifts', () => {
    expect(dates('2024-02-29', 12)).toEqual({
      proposedPeriodStart: '2024-02-29',
      proposedPeriodEnd: '2025-02-27',
      proposedNextRenewalDate: '2025-02-28',
    });
    expect(dates('2023-01-31', 1)).toEqual({
      proposedPeriodStart: '2023-01-31',
      proposedPeriodEnd: '2023-02-27',
      proposedNextRenewalDate: '2023-02-28',
    });
  });

  it('rejects missing, fractional, negative and out-of-range intervals', () => {
    for (const months of [0, -1, 1.5, 1201, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => proposedRenewalPeriod(new Date('2026-11-23'), months)).toThrow(BadRequestException);
    }
    expect(() => proposedRenewalPeriod(new Date('2026-11-23'), null)).toThrow(BadRequestException);
  });
});
