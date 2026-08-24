import { Type, Transform } from 'class-transformer';
import {
  ArrayMinSize,
  IsBoolean,
  IsDateString,
  IsEmail,
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
  ValidateNested,
} from 'class-validator';
import {
  BillingFrequency,
  LegacyCustomerResolution,
  LegacyImportBatchStatus,
  LegacyImportRowStatus,
  SubscriptionStatus,
} from '../../generated/prisma/enums';
import { PageQueryDto } from '../../common/page-query.dto';

const MONEY = /^\d{1,11}(?:\.\d{1,3})?$/;

export class ImportBatchListQueryDto extends PageQueryDto {
  @IsOptional()
  @IsEnum(LegacyImportBatchStatus)
  status?: LegacyImportBatchStatus;
}

export class ImportRowListQueryDto extends PageQueryDto {
  @IsOptional()
  @IsEnum(LegacyImportRowStatus)
  status?: LegacyImportRowStatus;

  @IsOptional()
  @IsString()
  sheetName?: string;
}

export class LegacyCustomerMappingDto {
  @IsString()
  @Length(2, 250)
  companyName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(250)
  contactName?: string;

  @Transform(({ value }) => String(value).trim().toLowerCase())
  @IsEmail()
  primaryEmail!: string;

  @IsOptional()
  @Transform(({ value }) => (value ? String(value).trim().toLowerCase() : undefined))
  @IsEmail()
  secondaryEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  country?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  taxNumber?: string;

  @IsOptional()
  @IsString()
  @Length(2, 10)
  preferredLanguage = 'en';

  @IsUUID()
  billingEntityId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;
}

export class LegacySubscriptionMappingDto {
  @IsUUID()
  serviceTypeId!: string;

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
}

export class ReviewLegacyRowDto {
  @IsEnum(LegacyCustomerResolution)
  customerResolution!: LegacyCustomerResolution;

  @IsOptional()
  @IsUUID()
  candidateCustomerId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => LegacyCustomerMappingDto)
  customer?: LegacyCustomerMappingDto;

  @ValidateNested({ each: true })
  @Type(() => LegacySubscriptionMappingDto)
  @ArrayMinSize(1)
  subscriptions!: LegacySubscriptionMappingDto[];

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  resolutionNotes?: string;
}
