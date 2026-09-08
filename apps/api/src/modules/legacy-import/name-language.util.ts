// Arabic script blocks: Arabic (U+0600-06FF), Arabic Supplement (U+0750-077F), Arabic
// Extended-A (U+08A0-08FF), Arabic Presentation Forms A/B (U+FB50-FDFF, U+FE70-FEFE). The FEFE
// upper bound (not FEFF) is deliberate: U+FEFF is the zero-width no-break space/BOM character,
// not a real Arabic letter, and ESLint's no-irregular-whitespace rule flags it if it appears
// literally in source — excluding it from the range costs nothing, since no real customer name
// would ever consist of that character.
const ARABIC_SCRIPT = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻾]/;

/**
 * The legacy/canonical source workbooks carry exactly one customer-name value per row, sometimes
 * Arabic, sometimes English. Classify it into the correct bilingual field so the human reviewer
 * sees it pre-filled correctly and can add the missing translation later - this is script
 * detection, not translation, and the original text is never modified.
 */
export function splitBilingualName(raw?: string | null): { nameEn?: string; nameAr?: string } {
  const value = raw?.trim();
  if (!value) return {};
  return ARABIC_SCRIPT.test(value) ? { nameAr: value } : { nameEn: value };
}
