import { BadRequestException } from '@nestjs/common';
import { effectiveReceiptAmounts, paymentSummary, paymentUnits, signedMoney } from './payment-money';

const revision = (amount: string, voided = false, currency = 'JOD') => ({
  amount: { toString: () => amount },
  voided,
  currency,
});

const payment = (...revisions: ReturnType<typeof revision>[]) => ({
  receipt: { revisions },
});

describe('P1 financial balance rules (OD-4 / CL-1 / CL-2)', () => {
  it('uses exact three-decimal arithmetic and never accepts floating-point or negative syntax', () => {
    expect(paymentUnits('40.000')).toBe(40_000n);
    expect(paymentUnits('0.001')).toBe(1n);
    expect(paymentUnits('00001.2')).toBe(1_200n);
    expect(signedMoney(-1n)).toBe('-0.001');
    expect(signedMoney(0n)).toBe('0.000');
    for (const value of ['-1', '1.2345', '1e3', 'NaN', '', ' 1.000', '1,000.00']) {
      expect(() => paymentUnits(value)).toThrow(BadRequestException);
    }
  });

  it('calculates two partial receipts without counting the underlying payments twice', () => {
    const { amounts, unresolved } = effectiveReceiptAmounts(
      [payment(revision('40.000')), payment(revision('30.000'))], 'JOD',
    );
    expect(unresolved).toBe(0);
    expect(paymentSummary('100.000', amounts)).toEqual({
      total: '100.000', paid: '70.000', balance: '30.000', status: 'PARTIALLY_PAID',
    });
  });

  it('takes only the latest effective receipt revision when a receipt is corrected', () => {
    const { amounts } = effectiveReceiptAmounts([
      payment(revision('35.000'), revision('40.000')),
      payment(revision('30.000')),
    ], 'JOD');
    expect(paymentSummary('100.000', amounts)).toEqual({
      total: '100.000', paid: '65.000', balance: '35.000', status: 'PARTIALLY_PAID',
    });
  });

  it('excludes voided receipts while preserving other active receipt contributions', () => {
    const { amounts, unresolved } = effectiveReceiptAmounts([
      payment(revision('35.000'), revision('40.000')),
      payment(revision('30.000', true), revision('30.000')),
    ], 'JOD');
    expect(unresolved).toBe(0);
    expect(paymentSummary('100.000', amounts)).toEqual({
      total: '100.000', paid: '35.000', balance: '65.000', status: 'PARTIALLY_PAID',
    });
  });

  it('does not use original Payment amounts when a receipt is missing or mismatched', () => {
    const { amounts, unresolved } = effectiveReceiptAmounts([
      { receipt: null },
      payment(revision('5.000', false, 'USD')),
      payment(revision('12.500')),
    ], 'JOD');
    expect(unresolved).toBe(2);
    expect(paymentSummary('100.000', amounts)).toEqual({
      total: '100.000', paid: '12.500', balance: '87.500', status: 'PARTIALLY_PAID',
    });
  });

  it('quarantines invalid legacy receipt amounts instead of failing all customer balances', () => {
    const { amounts, unresolved } = effectiveReceiptAmounts([
      payment(revision('-20.000')),
      payment(revision('0.000')),
      payment(revision('not-a-number')),
      payment(revision('999999999999.000')),
      payment(revision('5.000')),
    ], 'JOD');
    expect(unresolved).toBe(4);
    expect(amounts).toEqual(['5.000']);
    expect(paymentSummary('100.000', amounts)).toEqual({
      total: '100.000', paid: '5.000', balance: '95.000', status: 'PARTIALLY_PAID',
    });
  });

  it('reports full collection and visible excess without silently allocating or refunding money', () => {
    expect(paymentSummary('100.000', ['100.000'])).toEqual({
      total: '100.000', paid: '100.000', balance: '0.000', status: 'PAID',
    });
    expect(paymentSummary('100.000', ['100.001'])).toEqual({
      total: '100.000', paid: '100.001', balance: '-0.001', status: 'OVERPAID',
    });
    expect(paymentSummary('100.000', [])).toEqual({
      total: '100.000', paid: '0.000', balance: '100.000', status: 'UNPAID',
    });
  });
});
