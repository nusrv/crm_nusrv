import { ConflictException, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';

interface RenewalInvoiceCase {
  status: string;
  customerDecision: string;
  dueDate: Date;
  proposedPeriodStart: Date | null;
  proposedPeriodEnd: Date | null;
  proposedNextRenewalDate: Date | null;
}

export function acceptedRenewalPeriod(renewal: RenewalInvoiceCase) {
  const { dueDate, proposedPeriodStart: start, proposedPeriodEnd: end, proposedNextRenewalDate: next } = renewal;
  if (renewal.status !== 'ACCEPTED' || renewal.customerDecision !== 'ACCEPTED') {
    throw new ConflictException('Customer acceptance is required for this renewal.');
  }
  // A prospective cycle begins on the subscription's current renewal date.
  // Both the official invoice and the tracking update must use one contiguous
  // period: the next renewal date is exactly one calendar day after its end.
  // A merely increasing but gapped/shifted sequence is not safe to fulfill.
  const day = 86_400_000;
  if (!start || !end || !next ||
      ![dueDate, start, end, next].every((date) => Number.isFinite(date.getTime())) ||
      start.getTime() !== dueDate.getTime() ||
      !(start < end) ||
      next.getTime() !== end.getTime() + day) {
    throw new ConflictException('Review or correct the proposed renewal period first.');
  }
  return { start, end, next };
}

/** Serialize prospective issuance and completion on the same subscription and renewal case. */
export async function lockAcceptedRenewal(tx: Prisma.TransactionClient, id: string, subscriptionId: string) {
  await tx.$queryRaw`SELECT id FROM subscriptions WHERE id = ${subscriptionId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM renewal_cases WHERE id = ${id} FOR UPDATE`;
  const renewal = await tx.renewalCase.findUnique({
    where: { id },
    include: { subscription: { include: { customer: true } } },
  });
  if (!renewal || renewal.subscriptionId !== subscriptionId) throw new NotFoundException('Renewal case not found.');
  const period = acceptedRenewalPeriod(renewal);
  const newerCycle = await tx.renewalCase.findFirst({
    where: { subscriptionId, dueDate: { gt: renewal.dueDate } },
    select: { id: true },
  });
  if (newerCycle || renewal.subscription.renewalDate.getTime() !== renewal.dueDate.getTime()) {
    throw new ConflictException('A newer cycle or tracking date supersedes this renewal case.');
  }
  return { renewal, period };
}
