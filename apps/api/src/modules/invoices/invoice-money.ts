import { BadRequestException } from '@nestjs/common';

const MONEY_SCALE = 3;
const RATE_SCALE = 4;
const MONEY_FACTOR = 10n ** BigInt(MONEY_SCALE);
const RATE_FACTOR = 10n ** BigInt(RATE_SCALE);

function parseScaled(value: string, scale: number, label: string): bigint {
  const normalized = String(value).trim();
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) {
    throw new BadRequestException(`${label} must be a non-negative decimal number.`);
  }
  const [whole, fraction = ''] = normalized.split('.');
  if (fraction.length > scale) {
    throw new BadRequestException(`${label} supports at most ${scale} decimal places.`);
  }
  return BigInt(whole!) * 10n ** BigInt(scale) + BigInt(fraction.padEnd(scale, '0') || '0');
}

function divideRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator / 2n) / denominator;
}

export function formatMoney(value: bigint): string {
  const whole = value / MONEY_FACTOR;
  const fraction = String(value % MONEY_FACTOR).padStart(MONEY_SCALE, '0');
  return `${whole}.${fraction}`;
}

export interface InvoiceLineCalculationInput {
  description: string;
  quantity: string;
  unitPrice: string;
  discountAmount: string;
  taxCategoryCode?: string | null;
  taxRate?: string | null;
  periodStart?: string | Date | null;
  periodEnd?: string | Date | null;
  sourceSubscriptionId?: string | null;
  serviceTypeSnapshot?: string | null;
  packageSnapshot?: string | null;
  serviceSnapshotText?: string | null;
  identifiersSnapshotJson?: unknown;
}

export interface CalculatedInvoiceLine extends InvoiceLineCalculationInput {
  position: number;
  quantity: string;
  unitPrice: string;
  discountAmount: string;
  taxRate: string | null;
  lineSubtotal: string;
  taxAmount: string;
  lineTotal: string;
}

export interface CalculatedInvoiceTotals {
  lines: CalculatedInvoiceLine[];
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  grandTotal: string;
}

/**
 * Exact integer arithmetic at the database's three-decimal money precision. Tax rates use four
 * decimal places and are percentages (16 means 16%). No browser-provided or persisted total is
 * trusted; every mutation goes through this function.
 */
export function calculateInvoice(lines: InvoiceLineCalculationInput[]): CalculatedInvoiceTotals {
  let subtotal = 0n;
  let discountTotal = 0n;
  let taxTotal = 0n;
  let grandTotal = 0n;

  const calculated = lines.map((line, index) => {
    const quantity = parseScaled(line.quantity, MONEY_SCALE, `Line ${index + 1} quantity`);
    const unitPrice = parseScaled(line.unitPrice, MONEY_SCALE, `Line ${index + 1} unit price`);
    const discount = parseScaled(
      line.discountAmount || '0',
      MONEY_SCALE,
      `Line ${index + 1} discount`,
    );
    if (quantity <= 0n) {
      throw new BadRequestException(`Line ${index + 1} quantity must be greater than zero.`);
    }
    const gross = divideRoundHalfUp(quantity * unitPrice, MONEY_FACTOR);
    if (discount > gross) {
      throw new BadRequestException(`Line ${index + 1} discount cannot exceed its gross amount.`);
    }
    const lineSubtotal = gross - discount;
    const rate =
      line.taxRate == null || line.taxRate === ''
        ? null
        : parseScaled(line.taxRate, RATE_SCALE, `Line ${index + 1} tax rate`);
    if (rate !== null && rate > 100n * RATE_FACTOR) {
      throw new BadRequestException(`Line ${index + 1} tax rate cannot exceed 100%.`);
    }
    // A missing rate remains explicitly missing for preflight. Its provisional arithmetic is zero
    // tax so a draft can still be reviewed; this is not a declaration that the tax treatment is 0%.
    const tax = rate === null ? 0n : divideRoundHalfUp(lineSubtotal * rate, 100n * RATE_FACTOR);
    const total = lineSubtotal + tax;

    subtotal += lineSubtotal;
    discountTotal += discount;
    taxTotal += tax;
    grandTotal += total;

    return {
      ...line,
      position: index + 1,
      quantity: formatMoney(quantity),
      unitPrice: formatMoney(unitPrice),
      discountAmount: formatMoney(discount),
      taxRate:
        rate === null
          ? null
          : `${rate / RATE_FACTOR}.${String(rate % RATE_FACTOR).padStart(RATE_SCALE, '0')}`,
      lineSubtotal: formatMoney(lineSubtotal),
      taxAmount: formatMoney(tax),
      lineTotal: formatMoney(total),
    };
  });

  return {
    lines: calculated,
    subtotal: formatMoney(subtotal),
    discountTotal: formatMoney(discountTotal),
    taxTotal: formatMoney(taxTotal),
    grandTotal: formatMoney(grandTotal),
  };
}

export function moneyEqual(left: { toString(): string } | string, right: string): boolean {
  return (
    parseScaled(left.toString(), MONEY_SCALE, 'Stored money value') ===
    parseScaled(right, MONEY_SCALE, 'Calculated money value')
  );
}
