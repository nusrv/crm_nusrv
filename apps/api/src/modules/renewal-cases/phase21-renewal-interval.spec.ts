import { BillingFrequency } from '../../generated/prisma/enums';
import { cycleStartDate } from './renewal-policy';

describe('Phase 2.1 renewal intervals', () => {
  it.each([12, 24, 36, 60, 17])(
    'uses an explicit %i-month interval without changing the due date',
    (months) => {
      const dueDate = new Date('2030-06-01T00:00:00.000Z');
      const result = cycleStartDate(
        new Date('2020-01-01T00:00:00.000Z'),
        dueDate,
        BillingFrequency.CUSTOM,
        months,
      );
      const expected = new Date(dueDate);
      expected.setUTCMonth(expected.getUTCMonth() - months);
      expect(result).toEqual(expected);
      expect(dueDate).toEqual(new Date('2030-06-01T00:00:00.000Z'));
    },
  );

  it('preserves legacy frequency behavior when no interval is stored', () => {
    expect(
      cycleStartDate(
        new Date('2020-01-01T00:00:00Z'),
        new Date('2027-01-01T00:00:00Z'),
        BillingFrequency.ANNUAL,
      ),
    ).toEqual(new Date('2026-01-01T00:00:00Z'));
  });
});
