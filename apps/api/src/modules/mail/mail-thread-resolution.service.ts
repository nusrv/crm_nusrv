import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import type { CommunicationThread } from '../../generated/prisma/client';

type TxClient = Prisma.TransactionClient;

/**
 * Slice B §13 — one canonical CommunicationThread per non-null RenewalCase, enforced ultimately by
 * the DB unique index on `renewal_case_id` (Slice A). Concurrent workers must not create two
 * threads for the same case: find-then-create-then-recover-on-conflict is the safe pattern here,
 * not a SELECT-then-blind-INSERT.
 *
 * The recovery lookup deliberately reads through `this.prisma` (a fresh connection/transaction),
 * never through the caller's `tx`. Under MariaDB's default REPEATABLE READ isolation, `tx`'s
 * consistent snapshot was established before the losing INSERT even attempted — a losing INSERT
 * only fails once the winner has actually committed (InnoDB blocks on the conflicting index entry
 * until the other transaction resolves), so the winning row is guaranteed committed by the time we
 * get here, but `tx`'s own snapshot predates that commit and will not see it. A fresh read is not
 * an optional robustness improvement here; a same-transaction retry-lookup was verified (via the
 * live MariaDB suite) to intermittently throw "no record was found" under real concurrency.
 */
@Injectable()
export class MailThreadResolutionService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveOrCreate(
    tx: TxClient,
    params: {
      renewalCaseId: string;
      customerId: string | null;
      mailConfigurationId: string;
      subject: string;
      occurredAt: Date;
    },
  ): Promise<CommunicationThread> {
    const existing = await tx.communicationThread.findUnique({
      where: { renewalCaseId: params.renewalCaseId },
    });
    if (existing) return existing;

    try {
      return await tx.communicationThread.create({
        data: {
          renewalCaseId: params.renewalCaseId,
          customerId: params.customerId,
          mailConfigurationId: params.mailConfigurationId,
          subject: params.subject,
          lastMessageAt: params.occurredAt,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return await this.prisma.communicationThread.findUniqueOrThrow({
          where: { renewalCaseId: params.renewalCaseId },
        });
      }
      throw error;
    }
  }
}
