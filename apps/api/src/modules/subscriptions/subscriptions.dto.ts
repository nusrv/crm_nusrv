import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { BillingFrequency, SubscriptionStatus } from '../../generated/prisma/enums';
import { PageQueryDto } from '../../common/page-query.dto';

const MONEY = /^\d{1,11}(?:\.\d{1,3})?$/;

export class SubscriptionListQueryDto extends PageQueryDto {
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsUUID()
  serviceTypeId?: string;

  @IsOptional()
  @IsEnum(SubscriptionStatus)
  status?: SubscriptionStatus;

  @IsOptional()
  @IsDateString()
  renewalFrom?: string;

  @IsOptional()
  @IsDateString()
  renewalTo?: string;
}

export class CreateSubscriptionDto {
  @IsUUID()
  customerId!: string;

  @IsUUID()
  serviceTypeId!: string;

  @Transform(({ value }) => String(value).trim().toUpperCase())
  @IsString()
  @Length(2, 80)
  subscriptionCode!: string;

  @IsString()
  @Length(2, 250)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsDateString()
  startDate!: string;

  @IsDateString()
  renewalDate!: string;

  @IsEnum(BillingFrequency)
  billingFrequency!: BillingFrequency;

  @IsOptional()
  @Matches(MONEY)
  supplierCost?: string;

  @Matches(MONEY)
  sellingPrice!: string;

  @Transform(({ value }) => String(value).trim().toUpperCase())
  @IsString()
  @Length(3, 3)
  currency!: string;

  @IsOptional()
  @IsBoolean()
  providerAutoRenews = true;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(720)
  graceHours = 24;

  @IsOptional()
  @IsEnum(SubscriptionStatus)
  status: SubscriptionStatus = SubscriptionStatus.ACTIVE;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  sourceLegacyReference?: string;
}

export class UpdateSubscriptionDto {
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsUUID()
  serviceTypeId?: string;

  @IsOptional()
  @IsString()
  @Length(2, 250)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  renewalDate?: string;

  @IsOptional()
  @IsEnum(BillingFrequency)
  billingFrequency?: BillingFrequency;

  @IsOptional()
  @Matches(MONEY)
  supplierCost?: string;

  @IsOptional()
  @Matches(MONEY)
  sellingPrice?: string;

  @IsOptional()
  @Transform(({ value }) => String(value).trim().toUpperCase())
  @IsString()
  @Length(3, 3)
  currency?: string;

  @IsOptional()
  @IsBoolean()
  providerAutoRenews?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(720)
  graceHours?: number;

  @IsOptional()
  @IsEnum(SubscriptionStatus)
  status?: SubscriptionStatus;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;
}
