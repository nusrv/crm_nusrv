import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Header, HttpCode, NotFoundException, Post, Query, Req, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../../audit/audit.service';
import { PrismaService } from '../../database/prisma.service';
import type { AuthenticatedRequest } from '../../identity/auth-user';
import { Roles } from '../../identity/roles.decorator';
import { readVerifiedAccessContext } from '../../identity/verified-access-context';
import { resolveDsnFollowUp } from './dsn-follow-up-resolution';
import { createPrismaDsnResolutionStore } from './dsn-prisma-store';

const PAGE_SIZE = 25;

/** Admin-only operator surface. No route invokes a transport or enqueues mail.
 * Independent default-off release gate. Disabled reads do not touch new tables.
 */
@Controller('mail/action-queue')
@Roles('ADMIN')
export class MailActionQueueController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService,
    private readonly config: ConfigService) {}

  private authorize(req: AuthenticatedRequest) {
    const context = readVerifiedAccessContext(req.user);
    if (!context) throw new UnauthorizedException('Invalid session.');
    if (!req.user.roles.includes('ADMIN')) throw new ForbiddenException('ADMIN required.');
    return context;
  }

  private enabled() {
    return this.config.get<string>('P2_ACTION_QUEUE_ENABLED') === 'true';
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  async list(@Req() req: AuthenticatedRequest, @Query('lane') lane: unknown, @Query('page') page: unknown, @Query('status') status: unknown) {
    this.authorize(req);
    if (!this.enabled()) return { enabled: false, items: [], hasMore: false };
    const selected = lane ?? 'FOLLOW_UP';
    const selectedStatus = status ?? 'OPEN';
    const rawPage = page ?? '1';
    if ((selected !== 'FOLLOW_UP' && selected !== 'UNCERTAIN_COMMUNICATION' && selected !== 'UNCERTAIN_REPLY') ||
        (selectedStatus !== 'OPEN' && selectedStatus !== 'RESOLVED') ||
        typeof rawPage !== 'string' || !/^[1-9][0-9]{0,2}$/.test(rawPage) || Number(rawPage) > 400) {
      throw new BadRequestException('Invalid action queue filter.');
    }
    const pagination = { skip: (Number(rawPage) - 1) * PAGE_SIZE, take: PAGE_SIZE + 1,
      orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }] };
    if (selected === 'FOLLOW_UP') {
      const rows = await this.prisma.mailDsnFollowUp.findMany({
        ...pagination, where: { status: selectedStatus }, select: {
          id: true, subjectType: true, subjectId: true, attemptId: true, recipient: true, originalMessageId: true,
          status: true, revision: true, createdAt: true, resolvedById: true, resolvedAt: true, resolutionReason: true,
          mailConfiguration: { select: { label: true } }, _count: { select: { observations: true } },
          observations: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 5,
            select: { id: true, folder: true, enhancedStatus: true, createdAt: true } },
        },
      });
      return { enabled: true, items: rows.slice(0, PAGE_SIZE), hasMore: rows.length > PAGE_SIZE };
    }
    if (selected === 'UNCERTAIN_COMMUNICATION') {
      const rows = await this.prisma.communicationOutbox.findMany({ ...pagination, where: { smtpUncertain: true },
        select: { id: true, recipient: true, status: true, lastAttemptAt: true, createdAt: true, renewalCaseId: true, resendOfId: true } });
      return { enabled: true, items: rows.slice(0, PAGE_SIZE), hasMore: rows.length > PAGE_SIZE };
    }
    const rows = await this.prisma.operatorReplyOutbox.findMany({ ...pagination, where: { smtpUncertain: true },
      select: { id: true, recipient: true, status: true, lastAttemptAt: true, createdAt: true, threadId: true, resendOfId: true } });
    return { enabled: true, items: rows.slice(0, PAGE_SIZE), hasMore: rows.length > PAGE_SIZE };
  }

  @Post('resolve')
  @Header('Cache-Control', 'no-store')
  @HttpCode(200)
  async resolve(@Req() req: AuthenticatedRequest, @Body() input: unknown) {
    const context = this.authorize(req);
    if (!this.enabled()) throw new ServiceUnavailableException('Action queue is not enabled.');
    const result = await resolveDsnFollowUp(createPrismaDsnResolutionStore(this.prisma, this.audit), context, input, () => new Date());
    switch (result.outcome) {
      case 'INVALID_REQUEST': throw new BadRequestException('Invalid task revision or resolution reason.');
      case 'FORBIDDEN': throw new ForbiddenException('Current ADMIN session required.');
      case 'NOT_FOUND': throw new NotFoundException('Follow-up not found.');
      case 'CONFLICT': throw new ConflictException('Follow-up changed. Refresh before resolving.');
      default: return result;
    }
  }
}
