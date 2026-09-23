import { IsBoolean, IsDateString, IsIn, IsNumber, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class UpdateAiSettingsDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  // V1 supports exactly one real provider — see AiSettingsService's own validation for why this is
  // still a free-text field rather than an enum (schema.prisma's AiSettings.provider doc comment).
  @IsOptional()
  @IsIn(['OPENAI'])
  provider?: 'OPENAI';

  @IsOptional()
  @IsString()
  @Length(1, 191)
  model?: string;

  // Blank/omitted on update means KEEP the existing stored key — see AiSettingsService.
  @IsOptional()
  @IsString()
  @Length(1, 500)
  apiKey?: string;

  // Explicit action, never inferred from a blank apiKey — mirrors MailSettingsService's
  // clearCredentials precedent exactly.
  @IsOptional()
  @IsBoolean()
  clearApiKey?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  confidenceThreshold?: number;

  @IsOptional()
  @IsBoolean()
  autoRouteAccept?: boolean;

  @IsOptional()
  @IsDateString()
  autoRouteAcceptCutoverAt?: string | null;
}
