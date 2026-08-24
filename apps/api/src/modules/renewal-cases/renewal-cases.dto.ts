import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsInt,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import type { RoleCode } from '@cp/shared';
import { ROLE_CODES } from '@cp/shared';
import { CommunicationOutboxStatus, RenewalCaseStatus } from '../../generated/prisma/enums';
import { PageQueryDto } from '../../common/page-query.dto';

export enum RenewalHoldFilter {
  ACTIVE = 'ACTIVE',
  NONE = 'NONE',
}

export class RenewalCaseListQueryDto extends PageQueryDto {
  @IsOptional()
  @IsDateString()
  dueFrom?: string;

  @IsOptional()
  @IsDateString()
  dueTo?: string;

  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsUUID()
  serviceTypeId?: string;

  @IsOptional()
  @IsEnum(RenewalCaseStatus)
  status?: RenewalCaseStatus;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(0)
  @Max(365)
  daysBeforeDue?: number;

  @IsOptional()
  @IsEnum(RenewalHoldFilter)
  holdStatus?: RenewalHoldFilter;
}

export class CreateRenewalHoldDto {
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  reason!: string;

  @IsOptional()
  @IsBoolean()
  stopsCustomerReminders = true;

  @IsOptional()
  @IsBoolean()
  stopsInternalNotifications = true;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

export class UpdateReminderRuleDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  daysBeforeDue?: number;

  @IsOptional()
  @IsUUID()
  templateId?: string;
}

export class UpdateRenewalTemplateDto {
  @IsOptional()
  @IsString()
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  subjectTemplate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  bodyTemplate?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateNotificationRuleDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  daysBeforeDue?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsIn(ROLE_CODES, { each: true })
  recipientRoles?: RoleCode[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsEmail({}, { each: true })
  recipientEmails?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  subjectTemplate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  bodyTemplate?: string;

  @IsOptional()
  @IsBoolean()
  suppressOnWorkflowHold?: boolean;
}

export class CommunicationOutboxListQueryDto extends PageQueryDto {
  @IsOptional()
  @IsEnum(CommunicationOutboxStatus)
  status?: CommunicationOutboxStatus;

  @IsOptional()
  @IsUUID()
  renewalCaseId?: string;
}

export class ManualRenewalEvaluationDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
