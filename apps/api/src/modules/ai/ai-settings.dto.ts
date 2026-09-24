import { IsBoolean, IsDateString, IsIn, IsNumber, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { SUPPORTED_AI_PROVIDERS, type AiProviderId } from './llm-provider-adapter';

export class UpdateAiSettingsDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  // Provider-neutral correction — accepts exactly the supported canonical provider IDs (never an
  // arbitrary unknown string in V1). See AiSettingsService.update() for the credential-safety rule
  // that applies when this value actually changes the stored provider.
  @IsOptional()
  @IsIn(SUPPORTED_AI_PROVIDERS)
  provider?: AiProviderId;

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
