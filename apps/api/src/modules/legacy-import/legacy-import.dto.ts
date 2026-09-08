import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsInt,
  IsObject,
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
  ChannelVerificationStatus,
  CustomerContactRole,
  LegacyCustomerResolution,
  LegacyImportBatchStatus,
  LegacyImportRowStatus,
  PackageClassificationStatus,
  PhoneType,
  SubscriptionIdentifierType,
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
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(500)
  override pageSize = 20;

  @IsOptional()
  @IsEnum(LegacyImportRowStatus)
  status?: LegacyImportRowStatus;

  @IsOptional()
  @IsString()
  sheetName?: string;
}

export class LegacyContactMappingDto {
  @IsOptional()
  @IsString()
  @MaxLength(191)
  ref?: string;

  @IsEnum(CustomerContactRole)
  role!: CustomerContactRole;

  @IsOptional()
  @IsString()
  @MaxLength(191)
  name?: string;

  @IsOptional()
  @Transform(({ value }) => (value ? String(value).trim().toLowerCase() : undefined))
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  phone?: string;

  @IsOptional()
  @IsBoolean()
  primary = false;
}

export class LegacyEmailChannelMappingDto {
  @IsOptional()
  @IsString()
  @MaxLength(191)
  contactRef?: string;

  @Transform(({ value }) => String(value).trim().toLowerCase())
  @IsEmail()
  email!: string;

  @IsEnum(CustomerContactRole)
  role: CustomerContactRole = CustomerContactRole.OTHER;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  label?: string;

  @IsOptional()
  @IsBoolean()
  primary = false;

  @IsOptional()
  @IsEnum(ChannelVerificationStatus)
  verificationStatus: ChannelVerificationStatus = ChannelVerificationStatus.UNVERIFIED;

  @IsOptional()
  @IsString()
  @MaxLength(191)
  holderName?: string;
}

export class LegacyPhoneChannelMappingDto {
  @IsOptional()
  @IsString()
  @MaxLength(191)
  contactRef?: string;

  @Transform(({ value }) => String(value).replace(/[\s()-]/g, ''))
  @Matches(/^\+[1-9]\d{7,18}$/)
  phoneNumber!: string;

  @Transform(({ value }) => String(value).replace(/[\s()-]/g, ''))
  @Matches(/^\+[1-9]\d{0,2}$/)
  countryCallingCode!: string;

  @IsEnum(PhoneType)
  phoneType: PhoneType = PhoneType.PHONE;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  rawValue?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  country?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  areaOrOperatorCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  subscriberNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  extension?: string;

  @IsEnum(CustomerContactRole)
  role: CustomerContactRole = CustomerContactRole.OTHER;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  label?: string;

  @IsOptional()
  @IsBoolean()
  primary = false;

  @IsOptional()
  @IsBoolean()
  active = true;

  @IsOptional()
  @IsEnum(ChannelVerificationStatus)
  verificationStatus: ChannelVerificationStatus = ChannelVerificationStatus.UNVERIFIED;

  @IsOptional()
  @IsString()
  @MaxLength(191)
  holderName?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class LegacyCustomerMappingDto {
  // At least one of nameEn/nameAr is required — enforced in LegacyImportService.validateReview()
  // for CREATE_NEW/NOT_DUPLICATE rows (there is no clean class-validator way to express "at least
  // one of two optional sibling fields", and this codebase's convention is to do such cross-field
  // checks in the service, same as the phone/calling-code and duplicate-email checks elsewhere).
  @IsOptional()
  @IsString()
  @MaxLength(191)
  nameEn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(191)
  nameAr?: string;

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
  @ValidateNested({ each: true })
  @Type(() => LegacyContactMappingDto)
  @ArrayMaxSize(20)
  contacts: LegacyContactMappingDto[] = [];

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => LegacyEmailChannelMappingDto)
  @ArrayMaxSize(30)
  emailChannels?: LegacyEmailChannelMappingDto[];

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => LegacyPhoneChannelMappingDto)
  @ArrayMaxSize(30)
  phoneChannels?: LegacyPhoneChannelMappingDto[];

  @IsOptional()
  @IsInt()
  sourceSequence?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  sourceLegacyReference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;
}

export class LegacySubscriptionIdentifierDto {
  @IsEnum(SubscriptionIdentifierType)
  type!: SubscriptionIdentifierType;

  @IsString()
  @Length(1, 500)
  value!: string;

  @IsOptional()
  @IsString()
  @MaxLength(191)
  label?: string;
}

export class LegacySubscriptionMappingDto {
  @IsUUID()
  serviceTypeId!: string;

  @IsOptional()
  @IsUUID()
  servicePackageId?: string;

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

  @IsOptional()
  @IsDateString()
  currentTermEndDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  paidLabel?: string;

  @IsOptional()
  @IsInt()
  sourceSequence?: number;

  @IsEnum(BillingFrequency)
  billingFrequency!: BillingFrequency;

  @IsInt()
  @Min(1)
  @Max(120)
  renewalIntervalMonths!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(120)
  contractTermMonths?: number;

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

  @IsString()
  @MaxLength(191)
  sourceRegistration!: string;

  @IsString()
  @Length(2, 191)
  packageNameSnapshot!: string;

  @IsOptional()
  @IsObject()
  packageSpecificationsSnapshot?: Record<string, unknown>;

  @IsBoolean()
  customPackage!: boolean;

  @IsEnum(PackageClassificationStatus)
  classificationStatus!: PackageClassificationStatus;

  @IsObject()
  classificationEvidence!: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  priceOverrideReason?: string;

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => LegacySubscriptionIdentifierDto)
  @ArrayMaxSize(50)
  identifiers: LegacySubscriptionIdentifierDto[] = [];

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
