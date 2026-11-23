import { BadRequestException } from '@nestjs/common';
import { formatMoney } from './invoice-money';
export function paymentUnits(value: string): bigint {
 if (!/^\d{1,11}(?:\.\d{1,3})?$/.test(value)) throw new BadRequestException('Amount must be an exact decimal with up to three places.');
 const [whole, fraction = ''] = value.split('.');
 return BigInt(whole!) * 1000n + BigInt(fraction.padEnd(3, '0'));
}
export function paymentSummary(total: string, amounts: string[]) {
 const due = paymentUnits(total), paid = amounts.reduce((sum, value) => sum + paymentUnits(value), 0n);
 return { total: formatMoney(due), paid: formatMoney(paid), balance: signedMoney(due - paid), status: paid > due ? 'OVERPAID' : paid === due ? 'PAID' : paid === 0n ? 'UNPAID' : 'PARTIALLY_PAID' };
}

export function signedMoney(units: bigint): string {
 return units < 0n ? `-${formatMoney(-units)}` : formatMoney(units);
}

function validPositiveAmount(value: string): boolean {
 return /^\d{1,11}(?:\.\d{1,3})?$/.test(value) && paymentUnits(value) > 0n;
}

export function effectiveReceiptAmounts(
 payments: { currency: string; amount: { toString(): string }; receipt: { revisions: { amount: { toString(): string }; voided: boolean; currency: string }[] } | null }[],
 currency: string,
) {
 const amounts: string[] = [];
 let unresolved = 0;
 for (const payment of payments) {
  const revision = payment.receipt?.revisions[0];
  if (!revision || payment.currency !== currency || revision.currency !== currency ||
      !validPositiveAmount(payment.amount.toString())) {
   unresolved += 1;
   continue;
  }
  // A malformed or nonpositive historical receipt must not crash the entire
  // balance projection or silently count as a negative collection. Keep its
  // immutable history intact and expose the row as unresolved for ADMIN review.
  if (revision.voided) continue;
  const amount = revision.amount.toString();
  if (!validPositiveAmount(amount)) {
   unresolved += 1;
   continue;
  }
  amounts.push(amount);
 }
 return { amounts, unresolved };
}
