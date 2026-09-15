import {
  SMTP_TIMEOUT_BUDGET_MS,
  SMTP_CONNECTION_TIMEOUT_MS,
  SMTP_GREETING_TIMEOUT_MS,
  SMTP_SOCKET_TIMEOUT_MS,
  STALE_PROCESSING_LEASE_MS,
} from './mail-timing.constants';

describe('mail timing constants', () => {
  it('sums the three SMTP phase timeouts into SMTP_TIMEOUT_BUDGET_MS', () => {
    expect(SMTP_TIMEOUT_BUDGET_MS).toBe(
      SMTP_CONNECTION_TIMEOUT_MS + SMTP_GREETING_TIMEOUT_MS + SMTP_SOCKET_TIMEOUT_MS,
    );
  });

  it('keeps every individual SMTP phase timeout bounded in tens-of-seconds-to-minutes, not hours', () => {
    expect(SMTP_CONNECTION_TIMEOUT_MS).toBeLessThanOrEqual(60_000);
    expect(SMTP_GREETING_TIMEOUT_MS).toBeLessThanOrEqual(60_000);
    expect(SMTP_SOCKET_TIMEOUT_MS).toBeLessThanOrEqual(5 * 60_000);
  });

  it('keeps the maximum legitimate SMTP operation duration strictly less than the stale-PROCESSING lease', () => {
    expect(SMTP_TIMEOUT_BUDGET_MS).toBeLessThan(STALE_PROCESSING_LEASE_MS);
  });

  it('maintains a meaningful safety margin (at least half the lease) between the two', () => {
    const margin = STALE_PROCESSING_LEASE_MS - SMTP_TIMEOUT_BUDGET_MS;
    expect(margin).toBeGreaterThanOrEqual(STALE_PROCESSING_LEASE_MS / 2);
  });
});
