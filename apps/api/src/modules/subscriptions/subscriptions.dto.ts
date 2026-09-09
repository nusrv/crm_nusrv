import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  ArrayMaxSize,
  ValidateIf,
  ValidateNested,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  BillingFrequency,
  SubscriptionIdentifierType,
  SubscriptionStatus,
} from '../../generated/prisma/enums';
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
  @IsUUID()
  servicePackageId?: string;

  @IsOptional()
  @IsUUID()
  billingEntityId?: string;

  @IsOptional()
  @Transform(({ value }) => String(value).trim().toUpperCase())
  @IsString()
  @Length(3, 3)
  currency?: string;

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

export class SubscriptionIdentifierDto {
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

export class CreateSubscriptionDto {
  @IsUUID()
  customerId!: string;

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

  // Renewal Date is intentionally NOT a field here: it is server-derived from
  // `startDate + renewalIntervalMonths` (calendar-month arithmetic — see `addCalendarMonths` in
  // `@cp/shared`) so a caller cannot submit a Renewal Date that contradicts the Start Date and
  // Renewal Interval, the same way `subscriptionCode` is never caller-supplied.
  @IsEnum(BillingFrequency)
  billingFrequency!: BillingFrequency;

  // Renewal Interval means how long after Start Date this subscription reaches its next renewal —
  // a distinct business concept from Billing Frequency (how often the customer is billed during
  // that period). Required for every new subscription so the canonical Renewal Date can always be
  // derived; never defaulted or guessed from Billing Frequency.
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

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  priceOverrideReason?: string;

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => SubscriptionIdentifierDto)
  @ArrayMaxSize(50)
  identifiers?: SubscriptionIdentifierDto[] = [];

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
  servicePackageId?: string;

  // Customer is intentionally NOT editable here: the Subscription Code encodes the owning
  // Customer's code (`<CUSTOMER_CODE>-S01`), so reassigning a subscription to a different customer
  // through a normal edit would silently make its own code lie about who it belongs to. A future
  // "Transfer Subscription" workflow (recoding included) would need to be a dedicated operation.
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

  // Unlike on create, an explicit Renewal Date IS declared here — but `SubscriptionsService.
  // update()` only ever accepts it for a subscription that has NO effective Renewal Interval at
  // all (a historical subscription that predates this concept): a direct correction, since there
  // is no interval to derive a canonical value from. For any subscription that DOES have one — the
  // "modern" case, whether from the existing record or set in this same request — supplying this
  // field at all is a hard error (`BadRequestException`), not a silent no-op: the API contract is
  // explicit that Renewal Date can only be derived (via Start Date / Renewal Interval) for a modern
  // subscription, never independently set. Omit this field, and Start Date / Renewal Interval, to
  // leave a modern subscription's Renewal Date untouched (e.g. a price-only edit).
  @IsOptional()
  @IsDateString()
  renewalDate?: string;

  @IsOptional()
  @IsEnum(BillingFrequency)
  billingFrequency?: BillingFrequency;

  // Plain @IsOptional() is NOT enough here: class-validator treats an explicit `null` the same as
  // "omitted" and skips the rest of the chain either way, which would let a caller PATCH
  // `{ renewalIntervalMonths: null }` straight past validation and, from there, into
  // SubscriptionsService.update()'s `...subscriptionInput` spread — clearing an existing modern
  // subscription's Renewal Interval in the database and falling it back into the legacy free-date
  // edit mode. @ValidateIf here means "run @IsInt/@Min/@Max only when the property is present at
  // all (including explicitly null)" — omitted stays untouched, but null is rejected outright.
  @ValidateIf((dto: UpdateSubscriptionDto) => dto.renewalIntervalMonths !== undefined)
  @IsInt()
  @Min(1)
  @Max(120)
  renewalIntervalMonths?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(120)
  contractTermMonths?: number;

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
  priceOverrideReason?: string;

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => SubscriptionIdentifierDto)
  @ArrayMaxSize(50)
  identifiers?: SubscriptionIdentifierDto[];

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;
}
