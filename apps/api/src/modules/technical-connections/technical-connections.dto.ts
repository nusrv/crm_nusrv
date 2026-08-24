import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';
import { IntegrationEnvironment, TechnicalConnectionType } from '../../generated/prisma/enums';

export class CreateTechnicalConnectionDto {
  @Transform(({ value }) => String(value).trim().toUpperCase())
  @IsString()
  @Length(2, 80)
  code!: string;

  @IsString()
  @Length(2, 150)
  name!: string;

  @IsEnum(TechnicalConnectionType)
  type!: TechnicalConnectionType;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  endpoint?: string;

  @IsOptional()
  @IsEnum(IntegrationEnvironment)
  environment: IntegrationEnvironment = IntegrationEnvironment.SANDBOX;

  @IsOptional()
  @IsBoolean()
  enabled = true;

  @IsOptional()
  @IsObject()
  capabilities?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  credentials?: Record<string, unknown>;
}

export class UpdateTechnicalConnectionDto {
  @IsOptional()
  @IsString()
  @Length(2, 150)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  endpoint?: string;

  @IsOptional()
  @IsEnum(IntegrationEnvironment)
  environment?: IntegrationEnvironment;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsObject()
  capabilities?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  credentials?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  clearCredentials?: boolean;
}
