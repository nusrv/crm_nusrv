import { Transform } from 'class-transformer';
import { IsEmail, IsEnum, IsOptional, IsString, IsUUID, Length, MaxLength } from 'class-validator';
import { CustomerStatus } from '../../generated/prisma/enums';
import { PageQueryDto } from '../../common/page-query.dto';

export class CustomerListQueryDto extends PageQueryDto {
  @IsOptional()
  @IsUUID()
  billingEntityId?: string;

  @IsOptional()
  @IsEnum(CustomerStatus)
  status?: CustomerStatus;
}

export class CreateCustomerDto {
  @Transform(({ value }) => String(value).trim().toUpperCase())
  @IsString()
  @Length(2, 50)
  customerCode!: string;

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
  @IsEnum(CustomerStatus)
  status: CustomerStatus = CustomerStatus.ACTIVE;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  sourceLegacyReference?: string;
}

export class UpdateCustomerDto {
  @IsOptional()
  @IsString()
  @Length(2, 250)
  companyName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(250)
  contactName?: string;

  @IsOptional()
  @Transform(({ value }) => String(value).trim().toLowerCase())
  @IsEmail()
  primaryEmail?: string;

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
  preferredLanguage?: string;

  @IsOptional()
  @IsUUID()
  billingEntityId?: string;

  @IsOptional()
  @IsEnum(CustomerStatus)
  status?: CustomerStatus;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;
}
