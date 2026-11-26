import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsObject,
  IsBoolean,
  Equals,
  IsDateString,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { PageQueryDto } from '../../common/page-query.dto';
import { InvoiceStatus } from '../../generated/prisma/enums';

const MONEY = /^\d{1,11}(?:\.\d{1,3})?$/;
const QUANTITY = /^\d{1,11}(?:\.\d{1,3})?$/;
const TAX_RATE = /^\d{1,3}(?:\.\d{1,4})?$/;
const IMAGE_DATA_URL = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=\r\n]+$/;

export class InvoiceListQueryDto extends PageQueryDto {
  @IsOptional()
  @IsEnum(InvoiceStatus)
  status?: InvoiceStatus;

  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsUUID()
  subscriptionId?: string;
}

export class InvoiceLineInputDto {
  @IsString()
  @Length(1, 5000)
  description!: string;

  @Matches(QUANTITY)
  quantity!: string;

  @Matches(MONEY)
  unitPrice!: string;

  @Matches(MONEY)
  discountAmount = '0';

  @IsOptional()
  @IsString()
  @MaxLength(50)
  taxCategoryCode?: string;

  @IsOptional()
  @Matches(TAX_RATE)
  taxRate?: string;

  @IsOptional()
  @IsDateString()
  periodStart?: string;

  @IsOptional()
  @IsDateString()
  periodEnd?: string;
}

export class CreateManualInvoiceDto {
  @IsUUID()
  billingEntityId!: string;

  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(191)
  customerNameEn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(191)
  customerNameAr?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  customerAddress?: string;

  @IsOptional()
  @IsString()
  @MaxLength(191)
  customerCountry?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  customerPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(191)
  customerTaxNumber?: string;

  @Matches(/^[A-Z]{3}$/)
  currencyCode!: string;

  @IsDateString()
  invoiceDate!: string;

  @IsDateString()
  periodStart!: string;

  @IsDateString()
  periodEnd!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => InvoiceLineInputDto)
  lines!: InvoiceLineInputDto[];
}

export class UpdateInvoiceDraftDto {
  @IsOptional() @IsObject() presentationVisibility?: Record<string, boolean>;
  @IsOptional()
  @IsIn(['011', '021', '111', '121', '012', '022', '112', '122'])
  invoiceTypeName?: string;
  @IsOptional() @Matches(/^[A-Z]{2}$/) issuerCountryCode?: string;
  @IsOptional() @Matches(/^[A-Z]{2}$/) buyerCountryCode?: string;
  @IsOptional() @IsUUID() selectedConnectionId?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) issuerBankDetails?: string;
  @IsOptional() @IsString() @MaxLength(500) issuerLegalNameAr?: string;

  @IsOptional()
  @IsDateString()
  invoiceDate?: string;

  @IsOptional()
  @IsDateString()
  periodStart?: string;

  @IsOptional()
  @IsDateString()
  periodEnd?: string;

  @IsOptional()
  @IsString()
  @MaxLength(191)
  customerNameEn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(191)
  customerNameAr?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  customerAddress?: string;

  @IsOptional()
  @IsString()
  @MaxLength(191)
  customerCountry?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  customerPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(191)
  customerTaxNumber?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => InvoiceLineInputDto)
  lines?: InvoiceLineInputDto[];
}

export class RecordFawtaraResultDto {
  @IsOptional()
  @IsIn(['SUBMITTED', 'ALREADY_SUBMITTED'])
  fawtaraStatus: 'SUBMITTED' | 'ALREADY_SUBMITTED' = 'SUBMITTED';

  @IsString()
  @Length(1, 191)
  invoiceNumber!: string;

  @IsOptional()
  @IsString()
  @MaxLength(191)
  invoiceUuid?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60000)
  qrPayload?: string;

  @IsOptional()
  @Matches(IMAGE_DATA_URL, { message: 'QR image must be a PNG, JPEG, or WebP data URL.' })
  @MaxLength(60000)
  qrImageDataUrl?: string;

  @IsDateString()
  acceptedAt!: string;

  @IsOptional()
  @Transform(({ value }) => String(value).trim().toUpperCase())
  @Length(3, 3)
  officialCurrencyCode?: string;

  @IsOptional()
  @Matches(MONEY)
  officialSubtotal?: string;

  @IsOptional()
  @Matches(MONEY)
  officialDiscountTotal?: string;

  @IsOptional()
  @Matches(MONEY)
  officialTaxTotal?: string;

  @IsOptional()
  @Matches(MONEY)
  officialGrandTotal?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  note?: string;
}

export class OfficializeInvoiceDto extends RecordFawtaraResultDto {
  @Matches(IMAGE_DATA_URL, { message: 'A PNG, JPEG, or WebP image is required.' })
  declare qrImageDataUrl: string;

  @Matches(/^[A-Z]{3}$/)
  declare officialCurrencyCode: string;

  @Matches(MONEY)
  declare officialSubtotal: string;

  @Matches(MONEY)
  declare officialDiscountTotal: string;

  @Matches(MONEY)
  declare officialTaxTotal: string;

  @Matches(MONEY)
  declare officialGrandTotal: string;
}

export class RecordFawtaraRejectionDto {
  @IsString()
  @Length(1, 4000)
  message!: string;
}

export class InvoiceReasonDto {
  @IsString()
  @Length(1, 4000)
  reason!: string;
}

export class SubmitOfficialInvoiceDto {
  @Equals('CREATE_REAL_JOFOTARA_INVOICE') confirmation!: string;
  @IsOptional() @IsUUID() connectionId?: string;
  @IsOptional() @IsBoolean() recoverUncertain?: boolean;
}
