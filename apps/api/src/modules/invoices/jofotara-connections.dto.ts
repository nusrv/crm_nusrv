import { IsBoolean, IsOptional, IsString, Length, Matches } from 'class-validator';
export class SaveJoFotaraConnectionDto {
  @IsOptional() @IsString() @Length(1, 191) displayName?: string;
  @IsOptional() @IsString() @Length(0, 191) userLabel?: string;
  @IsOptional() @Matches(/^\d{1,80}$/) incomeSourceSequence?: string;
  @IsOptional() @IsString() @Length(1, 2000) clientId?: string;
  @IsOptional() @IsString() @Length(1, 2000) secretKey?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsBoolean() productionSubmissionEnabled?: boolean;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}
