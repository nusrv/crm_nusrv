import { z } from 'zod';
import { MAX_AI_LANGUAGE_LENGTH } from './ai-context.util';
import { MAX_DRAFT_BODY_CHARS } from './ai-draft-context.util';

/**
 * Slice F §12 — the strict runtime schema every provider's raw drafting output must pass BEFORE it
 * is trusted, mirroring rawClassificationOutputSchema's own contract exactly (`.strict()` rejects
 * unexpected extra keys — no tool calls, no workflow commands, no confidence, no recipient, no
 * send flag ever reaches persistence/the UI, because it is never even accepted here).
 */
export const rawDraftOutputSchema = z
  .object({
    bodyText: z.string().min(1).max(MAX_DRAFT_BODY_CHARS),
    language: z.string().max(MAX_AI_LANGUAGE_LENGTH),
  })
  .strict();

export type RawDraftOutput = z.infer<typeof rawDraftOutputSchema>;
