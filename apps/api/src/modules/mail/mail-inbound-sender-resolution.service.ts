import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CustomerStatus } from '../../generated/prisma/enums';
import type { Prisma } from '../../generated/prisma/client';
import { normalizeEmailAddress } from './mail-address.util';

type PrismaClientLike = PrismaService | Prisma.TransactionClient;

export type SenderResolutionSource = 'NORMALIZED_CHANNEL' | 'LEGACY_SCALAR_FALLBACK';

export type SenderResolution =
  | { outcome: 'unique'; customerId: string; customerStatus: CustomerStatus; source: SenderResolutionSource }
  | { outcome: 'ambiguous' }
  | { outcome: 'unattributed' };

/**
 * Slice C §18 — the single authoritative inbound sender-attribution resolver. Mirrors
 * CustomerEmailResolutionService's outbound direction (customer -> email) but reversed
 * (email -> customer): normalized CustomerEmailAddress channels are the source of truth;
 * Customer.primaryEmail is a fallback used ONLY for customers with zero channel rows at all
 * (the same Foundation-Patch compatibility rule CustomerEmailResolutionService already applies),
 * so a stale legacy scalar can never override a customer's own normalized (even if currently
 * inactive) channel data.
 *
 * Trust level matches the rest of this codebase: stored `email`/`primaryEmail` values are trusted
 * to already be normalized (trim+lowercase — see customers.dto.ts's `@Transform`), exactly as
 * CustomerEmailResolutionService already assumes for its own comparisons. Only the untrusted,
 * externally-supplied inbound `fromAddress` is normalized here before comparison.
 */
@Injectable()
export class MailInboundSenderResolutionService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveSenderCustomer(
    fromAddress: string,
    client: PrismaClientLike = this.prisma,
  ): Promise<SenderResolution> {
    const normalized = normalizeEmailAddress(fromAddress);

    // Active normalized channels first — any of a customer's registered channels, not only the
    // primary one, since a customer may legitimately reply from a secondary registered address.
    const channelRows = await client.customerEmailAddress.findMany({
      where: { email: normalized, active: true },
      select: { customerId: true },
    });
    const channelCustomerIds = [...new Set(channelRows.map((row) => row.customerId))];

    if (channelCustomerIds.length === 1) {
      return this.finalize(channelCustomerIds[0]!, 'NORMALIZED_CHANNEL', client);
    }
    if (channelCustomerIds.length > 1) {
      return { outcome: 'ambiguous' };
    }

    // No active channel matched at all. Legacy scalar fallback, restricted to customers that have
    // NO CustomerEmailAddress row whatsoever — a customer with normalized channel data that simply
    // doesn't include this address must never be attributed via a stale legacy scalar.
    const legacyCandidates = await client.customer.findMany({
      where: { primaryEmail: normalized },
      select: { id: true, status: true },
    });
    const eligibleLegacy: typeof legacyCandidates = [];
    for (const candidate of legacyCandidates) {
      const hasAnyChannel = await client.customerEmailAddress.findFirst({
        where: { customerId: candidate.id },
        select: { id: true },
      });
      if (!hasAnyChannel) eligibleLegacy.push(candidate);
    }

    if (eligibleLegacy.length === 1) {
      const match = eligibleLegacy[0]!;
      return {
        outcome: 'unique',
        customerId: match.id,
        customerStatus: match.status,
        source: 'LEGACY_SCALAR_FALLBACK',
      };
    }
    if (eligibleLegacy.length > 1) {
      return { outcome: 'ambiguous' };
    }
    return { outcome: 'unattributed' };
  }

  private async finalize(
    customerId: string,
    source: SenderResolutionSource,
    client: PrismaClientLike,
  ): Promise<SenderResolution> {
    const customer = await client.customer.findUniqueOrThrow({
      where: { id: customerId },
      select: { status: true },
    });
    return { outcome: 'unique', customerId, customerStatus: customer.status, source };
  }
}
