import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import { SUPPORTED_AI_PROVIDERS, type AiProviderId } from './llm-provider-adapter';

export class DiscoverAiModelsDto {
  @IsIn(SUPPORTED_AI_PROVIDERS)
  provider!: AiProviderId;

  // Optional — see AiModelDiscoveryService for the exact rules governing when this is required
  // (switching provider, or no configuration saved yet) versus when it may be omitted (refreshing
  // the currently saved provider, which uses the stored encrypted key server-side). Never persisted,
  // audited, logged, or returned by this operation — see that service's own doc comment.
  @IsOptional()
  @IsString()
  @Length(1, 500)
  apiKey?: string;
}
