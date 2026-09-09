import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';

const MIN_DIGITS = 2;

/**
 * The single authoritative source of new Subscription Codes (`<CUSTOMER_CODE>-S01`, `-S02`, ...),
 * used by manual subscription creation and Legacy Import alike so the two never drift into
 * separate numbering.
 *
 * Each Customer owns one independent, monotonically increasing sequence in
 * `SubscriptionCodeSequence` — never derived by counting or max()-ing existing `subscriptions`
 * rows, since a deleted subscription must not free its number for reuse. Call `next()` inside the
 * same `$transaction` as the subscription insert it is for: the underlying `UPDATE` takes an
 * exclusive row lock on that Customer's sequence row until the transaction commits, so two
 * concurrent creates under the same Customer serialize on this one row instead of racing — a
 * duplicate code is not possible even under concurrent creation load. Two creates under *different*
 * Customers touch different rows and proceed fully in parallel.
 */
@Injectable()
export class SubscriptionCodeService {
  async next(tx: Prisma.TransactionClient, customerId: string): Promise<string> {
    const customer = await tx.customer.findUnique({
      where: { id: customerId },
      select: { customerCode: true },
    });
    if (!customer) throw new BadRequestException('Customer not found.');
    const sequence = await tx.subscriptionCodeSequence.upsert({
      where: { customerId },
      create: { customerId, lastValue: 1 },
      update: { lastValue: { increment: 1 } },
    });
    return `${customer.customerCode}-S${String(sequence.lastValue).padStart(MIN_DIGITS, '0')}`;
  }
}
