import { Injectable } from '@nestjs/common';
import { pageMetadata } from '../../common/page-query.dto';
import { PrismaService } from '../../database/prisma.service';
import type { CommunicationOutboxListQueryDto } from './renewal-cases.dto';

@Injectable()
export class CommunicationOutboxService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: CommunicationOutboxListQueryDto) {
    const search = query.search?.trim();
    const where = {
      status: query.status,
      renewalCaseId: query.renewalCaseId,
      ...(search
        ? {
            OR: [
              { recipient: { contains: search, mode: 'insensitive' as const } },
              { subject: { contains: search, mode: 'insensitive' as const } },
              { subscription: { name: { contains: search, mode: 'insensitive' as const } } },
              { customer: { companyName: { contains: search, mode: 'insensitive' as const } } },
            ],
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.communicationOutbox.findMany({
        where,
        include: {
          customer: { select: { id: true, customerCode: true, companyName: true } },
          subscription: { select: { id: true, subscriptionCode: true, name: true } },
          reminderRule: { select: { id: true, code: true, name: true } },
          notificationRule: { select: { id: true, code: true, name: true } },
        },
        orderBy: { queuedAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.communicationOutbox.count({ where }),
    ]);
    return { data, meta: pageMetadata(total, query.page, query.pageSize) };
  }
}
