import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';

const MIN_DIGITS = 4;

/**
 * The single authoritative source of new Customer Codes (`FF0001`, `NS0001`, ...), used by both
 * manual customer creation and Legacy Import so the two never drift into separate numbering.
 *
 * Each Billing Entity owns one independent, monotonically increasing sequence in
 * `CustomerCodeSequence` — never derived by counting or max()-ing existing `customers` rows,
 * since deleted customers must not free their number for reuse. Call `next()` inside the same
 * `$transaction` as the customer insert it is for: the underlying `UPDATE` takes an exclusive row
 * lock on that Billing Entity's sequence row until the transaction commits, so two concurrent
 * creates under the same Billing Entity serialize on this one row instead of racing — a duplicate
 * code is not possible even under concurrent creation load. Two creates under *different* Billing
 * Entities touch different rows and proceed fully in parallel.
 */
@Injectable()
export class CustomerCodeService {
  async next(tx: Prisma.TransactionClient, billingEntityId: string): Promise<string> {
    const billingEntity = await tx.billingEntity.findUnique({
      where: { id: billingEntityId },
      select: { customerCodePrefix: true },
    });
    if (!billingEntity) throw new BadRequestException('Billing Entity not found.');
    const sequence = await tx.customerCodeSequence.upsert({
      where: { billingEntityId },
      create: { billingEntityId, lastValue: 1 },
      update: { lastValue: { increment: 1 } },
    });
    return `${billingEntity.customerCodePrefix}${String(sequence.lastValue).padStart(MIN_DIGITS, '0')}`;
  }
}
