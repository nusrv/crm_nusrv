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
      // No `mode: 'insensitive'` here: that filter is Postgres/MongoDB-only and Prisma throws a
      // validation error for it against a mysql datasource. MariaDB's utf8mb4_unicode_ci columns
      // are already case-insensitive by collation, so a plain `contains` is sufficient.
      ...(search
        ? {
            OR: [
              { recipient: { contains: search } },
              { subject: { contains: search } },
              { subscription: { name: { contains: search } } },
              { customer: { nameEn: { contains: search } } },
              { customer: { nameAr: { contains: search } } },
            ],
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.communicationOutbox.findMany({
        where,
        include: {
          customer: { select: { id: true, customerCode: true, nameEn: true, nameAr: true } },
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
