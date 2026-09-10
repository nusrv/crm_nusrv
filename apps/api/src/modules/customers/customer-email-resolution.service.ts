import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';

type PrismaClientLike = PrismaService | Prisma.TransactionClient;

export type ResolvedRecipientSource = 'NORMALIZED_PRIMARY' | 'LEGACY_SCALAR_FALLBACK';

export interface ResolvedCustomerRecipient {
  email: string;
  source: ResolvedRecipientSource;
}

/**
 * The single authoritative place that decides which email address represents a Customer's current
 * primary contact — for anything new (including future real SMTP delivery). Phase 2.2's normalized
 * CustomerEmailAddress channels are the source of truth; Customer.primaryEmail remains a
 * backward-compatible scalar kept in sync where possible, never trusted directly by new code.
 *
 * Deterministic rule, in order:
 *   1. An active, primary CustomerEmailAddress exists -> that email wins (NORMALIZED_PRIMARY).
 *   2. No CustomerEmailAddress row exists for this customer at all (data predates the channel
 *      model, or was created through a path that never populated one) -> fall back to the legacy
 *      Customer.primaryEmail scalar, since it is the only signal available, not a knowingly-stale
 *      one (LEGACY_SCALAR_FALLBACK).
 *   3. CustomerEmailAddress rows exist for this customer, but none is currently active+primary
 *      (the primary was deactivated or demoted with no replacement designated) -> return null.
 *      This never falls back to the scalar: we know normalized data exists and it is telling us
 *      there is no current valid recipient, so a caller must not send to a channel we already know
 *      is inactive merely because the legacy scalar still contains its old value.
 *
 * Nothing here ever invents/auto-promotes a replacement primary — that would require a business
 * rule this application does not define, so the honest answer in that situation is "no valid
 * recipient right now", not a guess.
 */
@Injectable()
export class CustomerEmailResolutionService {
  constructor(private readonly prisma: PrismaService) {}

  async resolvePrimaryRecipient(
    customerId: string,
    client: PrismaClientLike = this.prisma,
  ): Promise<ResolvedCustomerRecipient | null> {
    const activePrimary = await client.customerEmailAddress.findFirst({
      where: { customerId, primary: true, active: true },
      orderBy: { createdAt: 'asc' },
      select: { email: true },
    });
    if (activePrimary) {
      return { email: activePrimary.email, source: 'NORMALIZED_PRIMARY' };
    }

    const anyChannelExists = await client.customerEmailAddress.findFirst({
      where: { customerId },
      select: { id: true },
    });
    if (anyChannelExists) {
      return null;
    }

    const customer = await client.customer.findUnique({
      where: { id: customerId },
      select: { primaryEmail: true },
    });
    return customer?.primaryEmail
      ? { email: customer.primaryEmail, source: 'LEGACY_SCALAR_FALLBACK' }
      : null;
  }
}
