// Arabic script blocks: Arabic (U+0600-06FF), Arabic Supplement (U+0750-077F), Arabic
// Extended-A (U+08A0-08FF), Arabic Presentation Forms A/B (U+FB50-FDFF, U+FE70-FEFE). The FEFE
// upper bound (not FEFF) is deliberate: U+FEFF is the zero-width no-break space/BOM character,
// not a real Arabic letter, and ESLint's no-irregular-whitespace rule flags it if it appears
// literally in source — excluding it from the range costs nothing, since no real customer name
// would ever consist of that character.
const ARABIC_CHAR = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻾]/;
const LATIN_LETTER = /[A-Za-z]/;
// Separator debris left at the edge of a span once the other script's block is sliced out (e.g.
// "Name - " or " - name"): whitespace, hyphens/dashes, and slashes.
const EDGE_SEPARATORS = /^[\s\-–—/]+|[\s\-–—/]+$/g;

/**
 * The legacy/canonical source workbooks carry exactly one customer-name value per row — sometimes
 * pure Arabic, sometimes pure English, and sometimes both languages already combined in one cell
 * (e.g. "Khayrat Al Shobak خيرات الشوبك"). Classify it into the correct bilingual field(s) so the
 * human reviewer sees it pre-filled correctly and only has to add a genuinely missing translation
 * — this is script detection, never translation, and the source text is never rewritten, only
 * (when safe) split at the boundary between an Arabic-script run and a Latin-script run.
 */
export function splitBilingualName(raw?: string | null): { nameEn?: string; nameAr?: string } {
  const value = raw?.trim();
  if (!value) return {};

  const hasArabic = ARABIC_CHAR.test(value);
  const hasLatin = LATIN_LETTER.test(value);

  if (hasArabic && hasLatin) {
    const split = trySplitMixedName(value);
    if (split) return split;
  }
  // Single-script (or neither — digits/symbols only, treated like plain Latin text) values, and
  // any mixed value that couldn't be split safely, are preserved whole rather than guessed at.
  return hasArabic ? { nameAr: value } : { nameEn: value };
}

/**
 * Only splits a name that is cleanly "Latin part, then Arabic part" or "Arabic part, then Latin
 * part" — never a Latin-Arabic-Latin sandwich (which would require reassembling two separated
 * Latin fragments, reordering the source text rather than just classifying it) and never a value
 * where Arabic and Latin letters are interleaved inside what would be the Arabic span. Returns
 * null whenever the split would be an unsafe guess, so the caller falls back to preserving the
 * original text unsplit.
 */
function trySplitMixedName(value: string): { nameEn: string; nameAr: string } | null {
  const chars = [...value];
  let firstArabic = -1;
  let lastArabic = -1;
  for (const [index, char] of chars.entries()) {
    if (ARABIC_CHAR.test(char)) {
      if (firstArabic === -1) firstArabic = index;
      lastArabic = index;
    }
  }
  if (firstArabic === -1) return null;

  const prefix = chars.slice(0, firstArabic).join('');
  const suffix = chars.slice(lastArabic + 1).join('');
  const hasPrefixText = prefix.trim().length > 0;
  const hasSuffixText = suffix.trim().length > 0;
  if (hasPrefixText && hasSuffixText) return null;

  const latinSpan = (hasPrefixText ? prefix : suffix).trim().replace(EDGE_SEPARATORS, '').trim();
  const arabicSpan = chars
    .slice(firstArabic, lastArabic + 1)
    .join('')
    .trim()
    .replace(EDGE_SEPARATORS, '')
    .trim();

  // The Arabic span (first Arabic char through the last) must itself be free of Latin letters —
  // if a Latin letter falls inside that range, the two scripts are interleaved, not cleanly
  // separable into two blocks, and splitting would silently drop or misplace text.
  if (LATIN_LETTER.test(arabicSpan)) return null;
  if (!arabicSpan || !latinSpan || !LATIN_LETTER.test(latinSpan)) return null;

  return { nameEn: latinSpan, nameAr: arabicSpan };
}
