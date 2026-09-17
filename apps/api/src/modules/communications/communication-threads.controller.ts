import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import type { AuthenticatedRequest } from '../../identity/auth-user';
import { Roles } from '../../identity/roles.decorator';
import { CommunicationThreadsService } from './communication-threads.service';
import { QueueOperatorReplyDto, ThreadListQueryDto } from './communication-threads.dto';
import { OperatorReplyService } from './operator-reply.service';

/**
 * Slice E §3/§20 — Communication Center backend. Read endpoints follow this repository's existing
 * "any authenticated internal user may read" pattern (no @Roles — mirrors CustomersController's
 * and ClassificationController's own GET endpoints). Mutating endpoints (reply, resolve) are
 * ADMIN + SALES_DEVELOPMENT only. Classification review itself is NOT duplicated here — the
 * frontend calls Slice D's existing ClassificationController endpoints directly (§7).
 */
@Controller('communication-threads')
export class CommunicationThreadsController {
  constructor(
    private readonly threads: CommunicationThreadsService,
    private readonly replies: OperatorReplyService,
  ) {}

  @Get()
  list(@Query() query: ThreadListQueryDto) {
    return this.threads.list(query);
  }

  @Get(':threadId')
  detail(@Param('threadId') threadId: string) {
    return this.threads.detail(threadId);
  }

  @Roles('ADMIN', 'SALES_DEVELOPMENT')
  @Post(':threadId/resolve')
  resolve(@Param('threadId') threadId: string, @Req() request: AuthenticatedRequest) {
    return this.threads.resolve(threadId, request.user.id);
  }

  @Roles('ADMIN', 'SALES_DEVELOPMENT')
  @Post(':threadId/replies')
  reply(
    @Param('threadId') threadId: string,
    @Body() dto: QueueOperatorReplyDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.replies.queueReply({
      threadId,
      actorId: request.user.id,
      idempotencyKey: dto.idempotencyKey,
      subject: dto.subject,
      bodyText: dto.bodyText,
    });
  }
}
