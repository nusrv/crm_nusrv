import { z } from 'zod';
import { AiIntent } from '../../generated/prisma/enums';
import { MAX_AI_LANGUAGE_LENGTH, MAX_AI_SUMMARY_LENGTH } from './ai-context.util';

/**
 * Slice D §5/§2 — the strict runtime schema every provider's raw structured output must pass
 * BEFORE it is trusted. `.strict()` rejects unexpected extra keys (defense against a provider
 * smuggling anything beyond the requested shape — tool calls, extra instructions, etc.).
 * `z.enum(AiIntent)` accepts only the frozen AiIntent enum values — no synonyms, no arbitrary
 * provider-invented intent string ever reaches persistence; anything else is a validation failure
 * (§2 — unknown provider output → HUMAN_REVIEW, never silently accepted).
 */
export const rawClassificationOutputSchema = z
  .object({
    intent: z.enum(AiIntent),
    confidence: z.number().min(0).max(1),
    requiresHumanReview: z.boolean(),
    summary: z.string().max(MAX_AI_SUMMARY_LENGTH),
    language: z.string().max(MAX_AI_LANGUAGE_LENGTH),
  })
  .strict();

export type RawClassificationOutput = z.infer<typeof rawClassificationOutputSchema>;
