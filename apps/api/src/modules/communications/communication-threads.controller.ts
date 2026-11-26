import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import type { AuthenticatedRequest } from '../../identity/auth-user';
import { Roles } from '../../identity/roles.decorator';
import { AiReplyDraftService } from './ai-reply-draft.service';
import { CommunicationThreadsService } from './communication-threads.service';
import { QueueOperatorReplyDto, ThreadListQueryDto } from './communication-threads.dto';
import { OperatorReplyService } from './operator-reply.service';

/**
 * Slice E §3/§20 — Communication Center backend. Read endpoints follow this repository's existing
 * "any authenticated internal user may read" pattern (no @Roles — mirrors CustomersController's
 * and ClassificationController's own GET endpoints). Mutating endpoints (reply, resolve) are
 * ADMIN only. Classification review itself is NOT duplicated here — the
 * frontend calls Slice D's existing ClassificationController endpoints directly (§7).
 *
 * Slice F — draft-reply generation is gated identically to reply/resolve (ADMIN)
 * even though it has no side effect on business state, since it is at least as consequential an
 * action to expose as sending, and this keeps the RBAC surface simple and consistent.
 */
@Controller('communication-threads')
export class CommunicationThreadsController {
  constructor(
    private readonly threads: CommunicationThreadsService,
    private readonly replies: OperatorReplyService,
    private readonly aiReplyDraft: AiReplyDraftService,
  ) {}

  @Get()
  list(@Query() query: ThreadListQueryDto) {
    return this.threads.list(query);
  }

  @Get(':threadId')
  detail(@Param('threadId') threadId: string) {
    return this.threads.detail(threadId);
  }

  @Roles('ADMIN')
  @Post(':threadId/resolve')
  resolve(@Param('threadId') threadId: string, @Req() request: AuthenticatedRequest) {
    return this.threads.resolve(threadId, request.user.id);
  }

  @Roles('ADMIN')
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

  @Roles('ADMIN')
  @Post(':threadId/messages/:messageId/read')
  read(@Param('threadId') threadId: string, @Param('messageId') messageId: string, @Req() request: AuthenticatedRequest) { return this.threads.markRead(threadId, messageId, request.user.id, true); }

  @Roles('ADMIN')
  @Post(':threadId/messages/:messageId/unread')
  unread(@Param('threadId') threadId: string, @Param('messageId') messageId: string, @Req() request: AuthenticatedRequest) { return this.threads.markRead(threadId, messageId, request.user.id, false); }

  @Roles('ADMIN')
  @Get(':threadId/outbox/:outboxId/evidence')
  evidence(@Param('threadId') threadId: string, @Param('outboxId') outboxId: string) {
    return this.replies.evidence(threadId, outboxId);
  }

  @Roles('ADMIN')
  @Post(':threadId/outbox/:outboxId/resend')
  resend(@Param('threadId') threadId: string, @Param('outboxId') outboxId: string, @Body() input: unknown, @Req() request: AuthenticatedRequest) {
    return this.replies.resend(threadId, outboxId, input, request.user.id);
  }

  /** Slice F §16 — synchronous, human-initiated, side-effect-free generation. No body: the request
   * always drafts from the thread's own latest inbound message and effective classification. */
  @Roles('ADMIN')
  @Post(':threadId/draft-reply')
  draftReply(@Param('threadId') threadId: string, @Req() request: AuthenticatedRequest) {
    return this.aiReplyDraft.generateDraft(threadId, request.user.id);
  }
}
