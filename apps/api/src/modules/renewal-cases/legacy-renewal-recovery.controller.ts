import { BadRequestException, Body, ConflictException, Controller, NotFoundException, Param, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import { AuditService } from '../../audit/audit.service';
import { PrismaService } from '../../database/prisma.service';
import type { AuthenticatedRequest } from '../../identity/auth-user';
import { Roles } from '../../identity/roles.decorator';

const inputSchema = z.object({
  periodStart: z.iso.date(),
  periodEnd: z.iso.date(),
  nextRenewalDate: z.iso.date(),
  reason: z.string().trim().min(1).max(500),
}).strict();
const day = 86_400_000;

@Roles('ADMIN')
@Controller('renewal-cases/:caseId/repair-proposed-dates')
export class LegacyRenewalRecoveryController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  @Post()
  repair(@Param('caseId') caseId: string, @Body() input: unknown, @Req() req: AuthenticatedRequest) {
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) throw new BadRequestException('Enter valid proposed dates and a correction reason.');
    const { periodStart, periodEnd, nextRenewalDate, reason } = parsed.data;
    const values = {
      proposedPeriodStart: new Date(periodStart),
      proposedPeriodEnd: new Date(periodEnd),
      proposedNextRenewalDate: new Date(nextRenewalDate),
    };
    if (values.proposedPeriodStart > values.proposedPeriodEnd ||
        values.proposedNextRenewalDate.getTime() !== values.proposedPeriodEnd.getTime() + day) {
      throw new BadRequestException('The period end must precede the next renewal date by one day.');
    }
    return this.prisma.$transaction(async (tx) => {
      const initial = await tx.renewalCase.findUnique({ where: { id: caseId }, select: { subscriptionId: true } });
      if (!initial) throw new NotFoundException('Renewal case not found.');
      await tx.$queryRaw`SELECT id FROM subscriptions WHERE id = ${initial.subscriptionId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM renewal_cases WHERE id = ${caseId} FOR UPDATE`;
      const current = await tx.renewalCase.findUnique({ where: { id: caseId } });
      if (!current) throw new NotFoundException('Renewal case not found.');
      if (current.status !== 'ACCEPTED' || current.subscriptionId !== initial.subscriptionId ||
          current.dueDate.getTime() !== values.proposedPeriodStart.getTime()) {
        throw new ConflictException('Only an accepted case with a matching due date can be repaired.');
      }
      const newer = await tx.renewalCase.findFirst({
        where: { subscriptionId: current.subscriptionId, dueDate: { gt: current.dueDate } },
        select: { id: true },
      });
      if (newer) throw new ConflictException('A newer renewal cycle exists. Review the case history.');
      const fields = ['proposedPeriodStart', 'proposedPeriodEnd', 'proposedNextRenewalDate'] as const;
      const missing = fields.filter((field) => current[field] === null);
      if (!missing.length || fields.some((field) => current[field] && current[field].getTime() !== values[field].getTime())) {
        throw new ConflictException('Repair only missing values and retain all recorded proposed dates.');
      }
      const changed = await tx.renewalCase.updateMany({
        where: {
          id: caseId, status: 'ACCEPTED', dueDate: current.dueDate,
          proposedPeriodStart: current.proposedPeriodStart, proposedPeriodEnd: current.proposedPeriodEnd,
          proposedNextRenewalDate: current.proposedNextRenewalDate,
        },
        data: Object.fromEntries(missing.map((field) => [field, values[field]])),
      });
      if (changed.count !== 1) throw new ConflictException('Renewal changed. Reload and try again.');
      await this.audit.record({
        actorType: 'USER', actorId: req.user.id, eventKey: 'renewal.case.repaired_proposed_dates',
        subjectType: 'RenewalCase', subjectId: caseId,
        metadata: { reason, periodStart, periodEnd, nextRenewalDate, filled: missing },
      }, tx);
      return { ...values };
    }, { isolationLevel: 'ReadCommitted' });
  }
}
