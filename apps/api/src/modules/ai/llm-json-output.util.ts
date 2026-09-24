import { AiIntent } from '../../generated/prisma/enums';

const CLASSIFICATION_INTENT_LIST = Object.values(AiIntent).join('|');

/**
 * Anthropic/Google Gemini adapters — unlike OpenAI's Responses API `text.format` (a real provider-
 * side strict-JSON-Schema constraint), these providers are asked in plain language to emit ONLY a
 * raw JSON object matching this shape. This is instructions, not a guarantee: the adapter still
 * independently re-validates whatever comes back against the exact same
 * `rawClassificationOutputSchema` every provider must pass (see ai-classification-schema.ts) —
 * this text only shapes what the provider is asked to attempt, it is never trusted on its own.
 */
export const CLASSIFICATION_JSON_CONTRACT_INSTRUCTIONS = `Respond with ONLY a single raw JSON object and nothing else — no markdown code fences, no commentary before or after it. The object must have exactly these fields and no others: {"intent": <one of ${CLASSIFICATION_INTENT_LIST}>, "confidence": <number between 0 and 1>, "requiresHumanReview": <true or false>, "summary": <short plain-text string>, "language": <ISO 639-1 language code, e.g. "en">}.`;

/** Same discipline as CLASSIFICATION_JSON_CONTRACT_INSTRUCTIONS above, for draftReply — see
 * ai-draft-schema.ts for the schema every provider's output is independently re-validated against. */
export const DRAFT_JSON_CONTRACT_INSTRUCTIONS = `Respond with ONLY a single raw JSON object and nothing else — no markdown code fences, no commentary before or after it. The object must have exactly these fields and no others: {"bodyText": <the full suggested reply text>, "language": <ISO 639-1 language code, e.g. "en">}.`;

/**
 * Best-effort extraction of a JSON object from a provider's free-text response. Providers asked in
 * plain language for "only a raw JSON object" sometimes still wrap it in a markdown code fence, or
 * (more rarely) add a short preamble/postscript despite the instruction. This function never trusts
 * or repairs malformed JSON itself — it only strips the two specific, common wrapping patterns
 * before attempting a normal `JSON.parse`; whatever comes out is passed unmodified to the exact same
 * strict Zod schema every provider's output must pass. A string this cannot extract valid JSON from
 * throws, which the caller must convert to LlmMalformedOutputError — never silently coerced into a
 * best-guess object.
 */
export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const fenceMatch = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  const candidate = fenceMatch ? fenceMatch[1]!.trim() : trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) {
      throw new Error('Provider output did not contain a recognizable JSON object.');
    }
    return JSON.parse(candidate.slice(start, end + 1));
  }
}
