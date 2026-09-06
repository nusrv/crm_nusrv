// Phase 2.2 phone normalizer.
//
// Turns one raw free-text phone/fax cell into zero or more independent E.164 phone records.
// Rules implemented here mirror the ones approved in the canonical import workbook's
// `Phone_Rules` sheet — see PHASES/PHASE_02_2_CANONICAL_DATA_MIGRATION.md for the authoritative
// write-up with worked examples. This module never invents a missing digit: anything it cannot
// confidently resolve into a complete number is dropped rather than guessed.

export type PhoneType = 'MOBILE' | 'LANDLINE' | 'FAX' | 'PHONE';
export type PhoneVerificationStatus = 'UNVERIFIED' | 'VERIFIED' | 'INVALID';

export interface NormalizedPhone {
  rawValue: string;
  phoneNumber: string;
  countryCallingCode: string;
  phoneType: PhoneType;
  country?: string;
  areaOrOperatorCode?: string;
  subscriberNumber?: string;
  extension?: string;
  verificationStatus: PhoneVerificationStatus;
  normalizationMethod: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
}

interface ManualCorrection {
  match: RegExp;
  result: Omit<NormalizedPhone, 'rawValue' | 'normalizationMethod' | 'verificationStatus'> | null;
}

// Authoritative, Subscription-Officer-approved overrides. These always win over automatic
// parsing. A `result` of `null` means the value must never be imported as a phone channel.
const MANUAL_CORRECTIONS: ManualCorrection[] = [
  {
    // Sami Kashkol: two malformed legacy values, both replaced by one verified Iraqi mobile.
    match: /^\+?0?6477114466666$/,
    result: {
      phoneNumber: '+9647702987851',
      countryCallingCode: '+964',
      phoneType: 'MOBILE',
      country: 'Iraq',
      confidence: 'HIGH',
    },
  },
  {
    match: /^47901511318$/,
    result: {
      phoneNumber: '+9647702987851',
      countryCallingCode: '+964',
      phoneType: 'MOBILE',
      country: 'Iraq',
      confidence: 'HIGH',
    },
  },
  {
    // Malformed Jordan mobile missing a digit; a missing digit is never invented.
    match: /^0?79821889$/,
    result: null,
  },
  {
    // Khalil Hdaib.
    match: /^0?77332511$/,
    result: {
      phoneNumber: '+962797024222',
      countryCallingCode: '+962',
      areaOrOperatorCode: '79',
      subscriberNumber: '7024222',
      phoneType: 'MOBILE',
      country: 'Jordan',
      confidence: 'HIGH',
    },
  },
  {
    match: /^\+?9626\s?65536165$/,
    result: {
      phoneNumber: '+96265536165',
      countryCallingCode: '+962',
      areaOrOperatorCode: '6',
      subscriberNumber: '5536165',
      phoneType: 'LANDLINE',
      country: 'Jordan',
      confidence: 'HIGH',
    },
  },
  {
    // Dr. Eyad Shahrouri.
    match: /^0?7778448448$/,
    result: {
      phoneNumber: '+962778448448',
      countryCallingCode: '+962',
      areaOrOperatorCode: '77',
      subscriberNumber: '8448448',
      phoneType: 'MOBILE',
      country: 'Jordan',
      confidence: 'HIGH',
    },
  },
];

const LABELS: Array<{ pattern: RegExp; type: PhoneType }> = [
  { pattern: /\bfax\b/i, type: 'FAX' },
  { pattern: /\bmobile\b|\bcell\b/i, type: 'MOBILE' },
  { pattern: /\btel\b|\bphone\b|\blandline\b/i, type: 'PHONE' },
];

export function extractPhoneNumbers(rawText: unknown): NormalizedPhone[] {
  if (typeof rawText !== 'string') return [];
  const results: NormalizedPhone[] = [];
  for (const line of rawText.split(/\r?\n/)) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;
    const labelMatch = LABELS.find((entry) => entry.pattern.test(trimmedLine));
    const lineType = labelMatch?.type;
    const value = trimmedLine.replace(/^[A-Za-z][A-Za-z\s]*:\s*/, '').trim();
    if (!value) continue;
    for (const segment of splitSegments(value)) {
      const parsed = parseSegment(segment, lineType);
      if (parsed) results.push(parsed);
    }
  }
  return dedupe(results);
}

function dedupe(phones: NormalizedPhone[]): NormalizedPhone[] {
  const seen = new Set<string>();
  const result: NormalizedPhone[] = [];
  for (const phone of phones) {
    if (seen.has(phone.phoneNumber)) continue;
    seen.add(phone.phoneNumber);
    result.push(phone);
  }
  return result;
}

/**
 * Splits one phone cell/line into independent number segments, resolving the three documented
 * shapes: two full numbers joined by "-", a full number with a short "-"-joined suffix that
 * inherits its country/area code, and a base number with "/"-joined shorthand suffix digits.
 * Anything else is returned unsplit so pure formatting hyphens (e.g. Saudi mobiles) stay intact.
 */
function splitSegments(value: string): string[] {
  const slashParts = value.split('/');
  if (slashParts.length > 1 && slashParts.slice(1).every((part) => /^\d{1,3}$/.test(part.trim()))) {
    const base = slashParts[0]?.trim() ?? '';
    const baseDigits = digitsOnly(base);
    if (baseDigits.length >= 7) {
      const segments = [base];
      for (const suffix of slashParts.slice(1)) {
        const replaceLength = suffix.trim().length;
        segments.push(base.slice(0, base.length - replaceLength) + suffix.trim());
      }
      return segments;
    }
  }

  const dashParts = value.split(/\s*-\s*/);
  if (dashParts.length === 2) {
    const [left, right] = dashParts as [string, string];
    const leftDigits = digitsOnly(left);
    const rightDigits = digitsOnly(right);
    if (leftDigits.length >= 9 && rightDigits.length >= 9) {
      return [left, right];
    }
    if (leftDigits.length >= 9 && rightDigits.length >= 6 && rightDigits.length <= 8) {
      // The right fragment is a bare subscriber number; it inherits the left fragment's
      // country/area prefix. Work purely in digits so original spacing/punctuation in `left`
      // never throws off where the prefix ends.
      const prefixDigits = leftDigits.slice(0, leftDigits.length - rightDigits.length);
      const inheritedPrefix = left.trim().startsWith('+') ? '+' : '';
      return [left, `${inheritedPrefix}${prefixDigits}${rightDigits}`];
    }
  }

  return [value];
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

function parseSegment(segment: string, lineType: PhoneType | undefined): NormalizedPhone | null {
  const trimmed = segment.trim();
  if (!trimmed) return null;

  for (const correction of MANUAL_CORRECTIONS) {
    if (correction.match.test(digitsOnly(trimmed)) || correction.match.test(trimmed)) {
      if (!correction.result) return null;
      return {
        rawValue: trimmed,
        normalizationMethod: 'MANUAL_CONFIRMED_CORRECTION',
        verificationStatus: 'VERIFIED',
        ...correction.result,
        phoneType: lineType === 'FAX' ? 'FAX' : correction.result.phoneType,
      };
    }
  }

  const collapsed = trimmed.replace(/[\s-]+/g, '');
  const digits = digitsOnly(collapsed);

  // Explicit country code, e.g. "+962...", "00966...".
  if (collapsed.startsWith('+') || collapsed.startsWith('00')) {
    // A leading "00" is the international dialing prefix (meaning "the following is a country
    // code"), not part of the number itself — strip it the same way a leading "+" is implicit.
    const normalizedDigits = collapsed.startsWith('00') ? digits.slice(2) : digits;
    if (normalizedDigits.length < 8) return null; // country code with no real subscriber number
    const jordan = matchJordanWithCountryCode(normalizedDigits);
    if (jordan) return finalizeJordan(jordan, trimmed, lineType);
    const saudi = matchSaudiWithCountryCode(normalizedDigits);
    if (saudi) return finalizeSaudi(saudi, trimmed, lineType);
    if (normalizedDigits.length > 15) return null; // exceeds E.164 length; cannot trust it
    return {
      rawValue: trimmed,
      phoneNumber: `+${normalizedDigits}`,
      countryCallingCode: `+${normalizedDigits.slice(0, Math.min(3, normalizedDigits.length - 6))}`,
      phoneType: lineType ?? 'PHONE',
      verificationStatus: 'UNVERIFIED',
      normalizationMethod: 'EXPLICIT_COUNTRY_CODE',
      confidence: 'MEDIUM',
    };
  }

  // Jordan local mobile: 0 + 7[4-9] + 7 digits = 10 digits total.
  if (/^07[4-9]\d{7}$/.test(digits)) {
    return {
      rawValue: trimmed,
      phoneNumber: `+962${digits.slice(1)}`,
      countryCallingCode: '+962',
      areaOrOperatorCode: digits.slice(1, 3),
      subscriberNumber: digits.slice(3),
      phoneType: lineType === 'FAX' ? 'FAX' : 'MOBILE',
      country: 'Jordan',
      verificationStatus: 'UNVERIFIED',
      normalizationMethod: 'JORDAN_LOCAL_07',
      confidence: 'HIGH',
    };
  }

  // Jordan local landline: 0 + single-digit area code + 7 digits = 9 digits total.
  if (/^0[2-6]\d{7}$/.test(digits)) {
    return {
      rawValue: trimmed,
      phoneNumber: `+962${digits.slice(1)}`,
      countryCallingCode: '+962',
      areaOrOperatorCode: digits.slice(1, 2),
      subscriberNumber: digits.slice(2),
      phoneType: lineType === 'FAX' ? 'FAX' : 'LANDLINE',
      country: 'Jordan',
      verificationStatus: 'UNVERIFIED',
      normalizationMethod: 'JORDAN_LOCAL_FIXED',
      confidence: 'HIGH',
    };
  }

  // Saudi local mobile: 0 + 5 + 8 digits = 10 digits total.
  if (/^05\d{8}$/.test(digits)) {
    return {
      rawValue: trimmed,
      phoneNumber: `+966${digits.slice(1)}`,
      countryCallingCode: '+966',
      subscriberNumber: digits.slice(1),
      phoneType: lineType === 'FAX' ? 'FAX' : 'MOBILE',
      country: 'Saudi Arabia',
      verificationStatus: 'UNVERIFIED',
      normalizationMethod: 'SAUDI_LOCAL_MOBILE',
      confidence: 'HIGH',
    };
  }

  // Bare 7-digit Jordan subscriber number with no area code: default to Amman (6) at low
  // confidence, matching the workbook's own CONTEXT_MISSING_AREA / CUSTOMER_CONTEXT_AREA rule.
  if (/^\d{7}$/.test(digits)) {
    return {
      rawValue: trimmed,
      phoneNumber: `+9626${digits}`,
      countryCallingCode: '+962',
      areaOrOperatorCode: '6',
      subscriberNumber: digits,
      phoneType: lineType === 'FAX' ? 'FAX' : 'LANDLINE',
      country: 'Jordan',
      verificationStatus: 'UNVERIFIED',
      normalizationMethod: 'CONTEXT_MISSING_AREA',
      confidence: 'LOW',
    };
  }

  // Anything else — including a bare "+962" with no subscriber digits, or a fragment missing a
  // digit — cannot be completed without inventing data, so it is not imported as a phone channel.
  return null;
}

function matchJordanWithCountryCode(digits: string): { rest: string } | null {
  return digits.startsWith('962') ? { rest: digits.slice(3) } : null;
}

function finalizeJordan(
  match: { rest: string },
  rawValue: string,
  lineType: PhoneType | undefined,
): NormalizedPhone | null {
  const { rest } = match;
  if (/^7[4-9]\d{7}$/.test(rest)) {
    return {
      rawValue,
      phoneNumber: `+962${rest}`,
      countryCallingCode: '+962',
      areaOrOperatorCode: rest.slice(0, 2),
      subscriberNumber: rest.slice(2),
      phoneType: lineType === 'FAX' ? 'FAX' : 'MOBILE',
      country: 'Jordan',
      verificationStatus: 'UNVERIFIED',
      normalizationMethod: 'JORDAN_LOCAL_07',
      confidence: 'HIGH',
    };
  }
  if (/^[2-6]\d{7}$/.test(rest)) {
    return {
      rawValue,
      phoneNumber: `+962${rest}`,
      countryCallingCode: '+962',
      areaOrOperatorCode: rest.slice(0, 1),
      subscriberNumber: rest.slice(1),
      phoneType: lineType === 'FAX' ? 'FAX' : 'LANDLINE',
      country: 'Jordan',
      verificationStatus: 'UNVERIFIED',
      normalizationMethod: 'JORDAN_NATIONAL_FIXED_NO_TRUNK',
      confidence: 'HIGH',
    };
  }
  return null;
}

function matchSaudiWithCountryCode(digits: string): { rest: string } | null {
  return digits.startsWith('966') ? { rest: digits.slice(3) } : null;
}

function finalizeSaudi(
  match: { rest: string },
  rawValue: string,
  lineType: PhoneType | undefined,
): NormalizedPhone | null {
  const { rest } = match;
  if (/^5\d{8}$/.test(rest)) {
    return {
      rawValue,
      phoneNumber: `+966${rest}`,
      countryCallingCode: '+966',
      subscriberNumber: rest,
      phoneType: lineType === 'FAX' ? 'FAX' : 'MOBILE',
      country: 'Saudi Arabia',
      verificationStatus: 'UNVERIFIED',
      normalizationMethod: 'SAUDI_LOCAL_MOBILE',
      confidence: 'HIGH',
    };
  }
  return null;
}
