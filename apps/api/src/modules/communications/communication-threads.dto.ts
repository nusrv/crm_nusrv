import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PageQueryDto } from '../../common/page-query.dto';
import { ThreadStatus } from '../../generated/prisma/enums';

export class ThreadListQueryDto extends PageQueryDto {
  @IsOptional()
  @IsEnum(ThreadStatus)
  status?: ThreadStatus;

  @IsOptional()
  @IsUUID()
  renewalCaseId?: string;

  // §4 — "HUMAN_REVIEW / requires-attention" filter. Accepts the query-string form ("true"/"false")
  // the same way the rest of this codebase's boolean filters do.
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === 'true' || value === true)
  @IsBoolean()
  attention?: boolean;
}

const MAX_REPLY_BODY_LENGTH = 20_000; // generous for a human-composed reply; never unbounded.
const MAX_REPLY_SUBJECT_LENGTH = 500; // matches EmailMessage.subject's own VarChar(500) width.
const MAX_IDEMPOTENCY_KEY_LENGTH = 191; // matches OperatorReplyOutbox.idempotencyKey's column width.

/**
 * Slice E §8/§20 — deliberately whitelists only what a human reply may contain. No "to" field (the
 * recipient is always resolved server-side — see OperatorReplyService), no confidence, no workflow
 * command, no resultingAction-equivalent. §15 — idempotencyKey is client-generated (e.g. once per
 * compose action) and is the actual concurrency guard, backed by a DB unique constraint.
 */
export class QueueOperatorReplyDto {
  @IsString()
  @MaxLength(MAX_IDEMPOTENCY_KEY_LENGTH)
  idempotencyKey!: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_REPLY_SUBJECT_LENGTH)
  subject?: string;

  @IsString()
  @MaxLength(MAX_REPLY_BODY_LENGTH)
  bodyText!: string;
}
