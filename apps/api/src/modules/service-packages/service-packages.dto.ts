import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
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
import { PackageKind } from '../../generated/prisma/enums';

const MONEY = /^\d{1,11}(?:\.\d{1,3})?$/;

export class ServicePackageTermDto {
  @IsInt()
  @Min(1)
  @Max(120)
  termMonths!: number;

  @Transform(({ value }) => String(value).trim().toUpperCase())
  @Length(3, 3)
  currency!: string;

  @Matches(MONEY)
  standardSellingPrice!: string;

  @IsOptional()
  @Matches(MONEY)
  standardSupplierCost?: string;
}

export class CreateServicePackageDto {
  @IsUUID()
  serviceTypeId!: string;

  @Transform(({ value }) =>
    String(value)
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_'),
  )
  @Length(2, 100)
  code!: string;

  @IsString()
  @Length(2, 191)
  name!: string;

  @IsEnum(PackageKind)
  kind!: PackageKind;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsObject()
  specifications?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  sourceReference?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ServicePackageTermDto)
  terms: ServicePackageTermDto[] = [];
}

export class UpdateServicePackageDto {
  @IsOptional()
  @IsUUID()
  serviceTypeId?: string;

  @IsOptional()
  @IsString()
  @Length(2, 191)
  name?: string;

  @IsOptional()
  @IsEnum(PackageKind)
  kind?: PackageKind;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsObject()
  specifications?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ServicePackageTermDto)
  terms?: ServicePackageTermDto[];
}
