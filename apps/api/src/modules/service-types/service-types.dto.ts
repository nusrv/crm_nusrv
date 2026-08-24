import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class CreateServiceTypeDto {
  @Transform(({ value }) =>
    String(value)
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_'),
  )
  @IsString()
  @Length(2, 80)
  code!: string;

  @IsString()
  @Length(2, 150)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}

export class UpdateServiceTypeDto {
  @IsOptional()
  @IsString()
  @Length(2, 150)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
