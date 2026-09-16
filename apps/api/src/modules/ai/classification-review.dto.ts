import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { AiIntent } from '../../generated/prisma/enums';
import { MAX_AI_LANGUAGE_LENGTH, MAX_AI_SUMMARY_LENGTH } from './ai-context.util';

export const MAX_REVIEW_NOTES_LENGTH = 2_000;

/**
 * Slice D §20 — deliberately whitelists only the fields a human correction may actually contain.
 * There is NO field for provider confidence, workflow commands, payment approval, renewal-state
 * transitions, or infrastructure actions — the server always reconstructs correctedResultJson from
 * exactly these validated fields (see ClassificationReviewService), never from an arbitrary JSON
 * blob supplied by the client, so there is no way for a request body to smuggle an unexpected key
 * into what gets persisted. `resultingAction` is never accepted here and is always persisted NULL.
 */
export class CreateClassificationReviewDto {
  @IsEnum(AiIntent)
  correctedIntent!: AiIntent;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_AI_SUMMARY_LENGTH)
  summary?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_AI_LANGUAGE_LENGTH)
  language?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_REVIEW_NOTES_LENGTH)
  notes?: string;
}
