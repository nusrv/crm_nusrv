import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  ValidateIf,
  MaxLength,
} from 'class-validator';
import { CustomerContactRole, CustomerStatus } from '../../generated/prisma/enums';
import { PageQueryDto } from '../../common/page-query.dto';

const E164_PHONE = /^\+[1-9]\d{7,14}$/;
const COUNTRY_CALLING_CODE = /^\+[1-9]\d{0,2}$/;

export class CreateCustomerEmailAddressDto {
  @Transform(({ value }) => String(value).trim().toLowerCase())
  @IsEmail()
  email!: string;

  @IsOptional() @IsString() @MaxLength(191) holderName?: string;
  @IsEnum(CustomerContactRole) role!: CustomerContactRole;
  @IsOptional() @IsString() @MaxLength(100) label?: string;
  @IsOptional() @IsBoolean() primary = false;
}

export class UpdateCustomerEmailAddressDto {
  @IsOptional()
  @Transform(({ value }) => String(value).trim().toLowerCase())
  @IsEmail()
  email?: string;
  @IsOptional() @IsString() @MaxLength(191) holderName?: string;
  @IsOptional() @IsEnum(CustomerContactRole) role?: CustomerContactRole;
  @IsOptional() @IsString() @MaxLength(100) label?: string;
  @IsOptional() @IsBoolean() primary?: boolean;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class CreateCustomerPhoneNumberDto {
  @Transform(({ value }) => String(value).replace(/[\s()-]/g, ''))
  @Matches(E164_PHONE, { message: 'phoneNumber must use E.164 format, for example +962790000000.' })
  phoneNumber!: string;

  @Transform(({ value }) => String(value).replace(/[\s()-]/g, ''))
  @Matches(COUNTRY_CALLING_CODE)
  countryCallingCode!: string;

  @IsOptional() @IsString() @MaxLength(191) holderName?: string;
  @IsEnum(CustomerContactRole) role!: CustomerContactRole;
  @IsOptional() @IsString() @MaxLength(100) label?: string;
  @IsOptional() @IsBoolean() primary = false;
}

export class UpdateCustomerPhoneNumberDto {
  @IsOptional()
  @Transform(({ value }) => String(value).replace(/[\s()-]/g, ''))
  @Matches(E164_PHONE)
  phoneNumber?: string;
  @IsOptional()
  @Transform(({ value }) => String(value).replace(/[\s()-]/g, ''))
  @Matches(COUNTRY_CALLING_CODE)
  countryCallingCode?: string;
  @IsOptional() @IsString() @MaxLength(191) holderName?: string;
  @IsOptional() @IsEnum(CustomerContactRole) role?: CustomerContactRole;
  @IsOptional() @IsString() @MaxLength(100) label?: string;
  @IsOptional() @IsBoolean() primary?: boolean;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class CreateCustomerContactDto {
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

export class UpdateCustomerContactDto {
  @IsOptional() @IsEnum(CustomerContactRole) role?: CustomerContactRole;
  @IsOptional() @IsString() @MaxLength(191) name?: string;
  @IsOptional()
  @Transform(({ value }) => (value ? String(value).trim().toLowerCase() : undefined))
  @IsEmail()
  email?: string;
  @IsOptional() @IsString() @MaxLength(80) phone?: string;
  @IsOptional() @IsBoolean() primary?: boolean;
  @IsOptional() @IsBoolean() active?: boolean;
}

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
  @Matches(E164_PHONE)
  phone?: string;

  @ValidateIf((input: CreateCustomerDto) => Boolean(input.phone))
  @Matches(COUNTRY_CALLING_CODE)
  phoneCountryCallingCode?: string;

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
  @Matches(E164_PHONE)
  phone?: string;

  @IsOptional()
  @Matches(COUNTRY_CALLING_CODE)
  phoneCountryCallingCode?: string;

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
