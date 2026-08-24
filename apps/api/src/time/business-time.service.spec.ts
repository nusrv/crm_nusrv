import { BusinessTimeService } from './business-time.service';

function service(timezone = 'Asia/Amman') {
  return new BusinessTimeService({ getOrThrow: () => timezone } as never);
}

describe('BusinessTimeService', () => {
  it('uses Asia/Amman rather than the operating-system timezone at a date boundary', () => {
    const time = service();
    expect(time.businessDateKey(new Date('2026-08-23T21:30:00.000Z'))).toBe('2026-08-24');
    expect(
      time.daysUntil(new Date('2026-08-24T00:00:00.000Z'), new Date('2026-08-23T21:30:00Z')),
    ).toBe(0);
  });

  it('keeps database DATE semantics stable while the business date changes', () => {
    const time = service('America/New_York');
    expect(time.businessDateKey(new Date('2026-08-24T02:00:00.000Z'))).toBe('2026-08-23');
    expect(
      time.daysUntil(new Date('2026-08-24T00:00:00.000Z'), new Date('2026-08-24T02:00:00Z')),
    ).toBe(1);
  });
});
