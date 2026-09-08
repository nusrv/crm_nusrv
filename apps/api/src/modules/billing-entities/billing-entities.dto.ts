import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';
import { PaymentScope } from '../../generated/prisma/enums';

export class CreateBillingEntityDto {
  @Transform(({ value }) => String(value).trim().toUpperCase())
  @IsString()
  @Length(2, 80)
  code!: string;

  // Immutable after creation (absent from UpdateBillingEntityDto, same as `code`): every
  // Customer Code under this Billing Entity is generated as `${customerCodePrefix}${sequence}`,
  // so changing this after customers exist would make already-issued codes inconsistent with any
  // newly generated ones.
  @Transform(({ value }) => String(value).trim().toUpperCase())
  @IsString()
  @Length(1, 10)
  customerCodePrefix!: string;

  @IsString()
  @Length(2, 250)
  name!: string;

  @IsString()
  @Length(2, 250)
  legalName!: string;

  @IsEnum(PaymentScope)
  paymentScope!: PaymentScope;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  taxNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  address?: string;

  @IsOptional()
  @IsEmail()
  invoiceEmail?: string;
}

export class UpdateBillingEntityDto {
  @IsOptional()
  @IsString()
  @Length(2, 250)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(2, 250)
  legalName?: string;

  @IsOptional()
  @IsEnum(PaymentScope)
  paymentScope?: PaymentScope;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  taxNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  address?: string;

  @IsOptional()
  @IsEmail()
  invoiceEmail?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
