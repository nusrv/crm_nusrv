import {
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
} from 'class-validator';

export class CreateSubscriptionConnectionDto {
  @IsUUID()
  subscriptionId!: string;

  @IsUUID()
  technicalConnectionId!: string;

  @IsString()
  @Length(1, 500)
  remoteIdentifier!: string;

  @IsOptional()
  @IsObject()
  actionProfile?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  active = true;
}

export class UpdateSubscriptionConnectionDto {
  @IsOptional()
  @IsUUID()
  technicalConnectionId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  remoteIdentifier?: string;

  @IsOptional()
  @IsObject()
  actionProfile?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
