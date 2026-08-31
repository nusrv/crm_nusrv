import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

const POSITIVE_RATE = /^(?:0\.\d*[1-9]\d*|[1-9]\d*(?:\.\d{1,9})?)$/;

export class CurrencyListQueryDto {
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  active?: boolean;
}

export class CreateCurrencyDto {
  @Transform(({ value }) => String(value).trim().toUpperCase())
  @IsString()
  @Length(3, 3)
  @Matches(/^[A-Z]{3}$/)
  code!: string;

  @IsString()
  @Length(2, 100)
  name!: string;

  @Matches(POSITIVE_RATE)
  rateToJod!: string;

  @IsDateString()
  effectiveDate!: string;

  @IsOptional()
  @IsBoolean()
  active = true;
}

export class UpdateCurrencyDto {
  @IsOptional()
  @IsString()
  @Length(2, 100)
  name?: string;

  @IsOptional()
  @Matches(POSITIVE_RATE)
  rateToJod?: string;

  @IsOptional()
  @IsDateString()
  effectiveDate?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  changeReason?: string;
}
