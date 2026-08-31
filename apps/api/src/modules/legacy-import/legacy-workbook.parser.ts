import { createHash } from 'node:crypto';
import * as XLSX from '@e965/xlsx';

export interface ParsedLegacyRow {
  sheetName: string;
  sourceRowNumber: number;
  sourceReference: string;
  rowFingerprint: string;
  rawValues: Record<string, unknown>;
  rawPreview: Record<string, unknown>;
  suggestions: LegacySuggestions;
}

export interface ClassificationEvidence {
  sourceRegistration?: string;
  sourcePackageName?: string;
  information?: string;
  detectedServiceTypes: string[];
  matchedPackageCode?: string;
  matchedRules: string[];
  conflicts: string[];
}

export interface LegacySuggestions {
  companyName?: string;
  contactName?: string;
  primaryEmail?: string;
  secondaryEmail?: string;
  phone?: string;
  address?: string;
  billingEntityName?: string;
  sourceRegistration?: string;
  sourcePackageName?: string;
  serviceTypeName?: string;
  servicePackageCode?: string;
  servicePackageName?: string;
  classificationStatus: 'MATCHED_OFFICIAL' | 'CUSTOM' | 'MANUAL_REVIEW';
  classificationEvidence: ClassificationEvidence;
  sourceStartDate?: string;
  sourceEndDate?: string;
  sourceRenewalReminderDate?: string;
  startDate?: string;
  renewalDate?: string;
  sellingPrice?: string;
  currency?: string;
  billingFrequency?: string;
  renewalIntervalMonths?: number;
  description?: string;
  identifiers: Array<{ type: 'DOMAIN'; value: string }>;
  contacts: Array<{ role: 'PRIMARY' | 'TECHNICAL' | 'OTHER'; name?: string; email?: string }>;
  issues: string[];
}

interface CatalogSignature {
  code: string;
  name: string;
  serviceType: string;
  aliases: string[];
  expected?: {
    webSpaceGb?: number;
    mailSpaceGb?: number;
    monthlyTransferGb?: number;
    ramGb?: number;
    cpuCores?: number;
    storageSsdGb?: number;
    os?: string;
  };
}

const EXPECTED_HEADER =
  /(renewal|company|e-?mail|registration|contact|address|billing|information)/i;
const SENSITIVE_LABEL = /(user(name)?|login|pass(word)?|token|secret|credential|api.?key)/i;
const SERVICE_TYPES = new Map([
  ['domain', 'Domain'],
  ['ssl', 'SSL'],
  ['hosting', 'Hosting'],
  ['dedicated server', 'Dedicated Server'],
  ['support', 'Support'],
  ['antivirus', 'Antivirus'],
  ['dns hosting', 'DNS Hosting'],
  ['app subscription', 'App Subscription'],
]);
const CATALOG: CatalogSignature[] = [
  {
    code: 'HOSTING_CUSTOM_400GB',
    name: 'Custom PLAN 400GB',
    serviceType: 'Hosting',
    aliases: ['custom plan 400gb'],
    expected: { webSpaceGb: 50, mailSpaceGb: 350, monthlyTransferGb: 500 },
  },
  {
    code: 'HOSTING_CUSTOM_250GB',
    name: 'Custom PLAN 250GB',
    serviceType: 'Hosting',
    aliases: ['custom plan 250gb'],
    expected: { webSpaceGb: 50, mailSpaceGb: 200, monthlyTransferGb: 500 },
  },
  {
    code: 'HOSTING_CUSTOM_100GB',
    name: 'Custom PLAN 100GB',
    serviceType: 'Hosting',
    aliases: ['custom plan 100gb'],
    expected: { webSpaceGb: 50, mailSpaceGb: 100, monthlyTransferGb: 500 },
  },
  {
    code: 'HOSTING_DIAMOND',
    name: 'DIAMOND PLAN',
    serviceType: 'Hosting',
    aliases: ['diamond', 'diamond plan'],
    expected: { webSpaceGb: 50, mailSpaceGb: 40, monthlyTransferGb: 500 },
  },
  {
    code: 'HOSTING_PLATINUM',
    name: 'PLATINUM PLAN',
    serviceType: 'Hosting',
    aliases: ['platinum', 'platinum plan'],
    expected: { webSpaceGb: 50, mailSpaceGb: 20, monthlyTransferGb: 500 },
  },
  {
    code: 'HOSTING_PREMIUM',
    name: 'PREMIUM PLAN',
    serviceType: 'Hosting',
    aliases: ['premium', 'premium plan'],
    expected: { webSpaceGb: 30, mailSpaceGb: 8, monthlyTransferGb: 250 },
  },
  {
    code: 'SSL_SINGLE',
    name: 'SSL Certificate',
    serviceType: 'SSL',
    aliases: ['ssl', 'ssl certificate'],
  },
  {
    code: 'SSL_WILDCARD',
    name: 'SSL Certificate Wild',
    serviceType: 'SSL',
    aliases: ['ssl certificate wild', 'ssl wildcard', 'wildcard ssl'],
  },
  {
    code: 'DEDICATED_LINUX_8X',
    name: '8X Power - LINUX',
    serviceType: 'Dedicated Server',
    aliases: ['8x power - linux', '8x power linux'],
    expected: { ramGb: 8, cpuCores: 4, storageSsdGb: 50, os: 'linux' },
  },
  {
    code: 'DEDICATED_LINUX_4X',
    name: '4X Power - LINUX',
    serviceType: 'Dedicated Server',
    aliases: ['4x power - linux', '4x power linux'],
    expected: { ramGb: 4, cpuCores: 2, storageSsdGb: 50, os: 'linux' },
  },
  {
    code: 'DEDICATED_LINUX_2X',
    name: '2X Power - LINUX',
    serviceType: 'Dedicated Server',
    aliases: ['2x power - linux', '2x power linux'],
    expected: { ramGb: 2, cpuCores: 1, storageSsdGb: 50, os: 'linux' },
  },
  {
    code: 'DEDICATED_WINDOWS_8X',
    name: '8X Power - WINDOWS',
    serviceType: 'Dedicated Server',
    aliases: ['8x power - windows', '8x power windows'],
    expected: { ramGb: 8, cpuCores: 4, storageSsdGb: 50, os: 'windows' },
  },
  {
    code: 'DEDICATED_WINDOWS_4X',
    name: '4X Power - WINDOWS',
    serviceType: 'Dedicated Server',
    aliases: ['4x power - windows', '4x power windows'],
    expected: { ramGb: 4, cpuCores: 2, storageSsdGb: 50, os: 'windows' },
  },
  {
    code: 'DEDICATED_WINDOWS_2X',
    name: '2X Power - WINDOWS',
    serviceType: 'Dedicated Server',
    aliases: ['2x power - windows', '2x power windows'],
    expected: { ramGb: 2, cpuCores: 1, storageSsdGb: 50, os: 'windows' },
  },
  {
    code: 'ADDON_EXTRA_SECURITY',
    name: 'Extra Security',
    serviceType: 'Dedicated Server',
    aliases: ['extra security'],
  },
  {
    code: 'ADDON_EXTRA_EMAIL',
    name: 'Extra Email',
    serviceType: 'Dedicated Server',
    aliases: ['extra email'],
  },
  {
    code: 'SUPPORT_PLATINUM',
    name: 'PLATINUM SUPPORT PLAN',
    serviceType: 'Support',
    aliases: ['platinum support plan'],
  },
  {
    code: 'SUPPORT_PREMIUM',
    name: 'PREMIUM SUPPORT PLAN',
    serviceType: 'Support',
    aliases: ['premium support plan'],
  },
  {
    code: 'SUPPORT_PROFESSIONAL',
    name: 'PROFESSIONAL SUPPORT PLAN',
    serviceType: 'Support',
    aliases: ['professional support plan'],
  },
];

export function parseLegacyWorkbook(buffer: Buffer, sourceFileName: string): ParsedLegacyRow[] {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true, dense: true });
  const parsed: ParsedLegacyRow[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: null,
      raw: true,
      blankrows: false,
    });
    const headerIndex = findHeaderRow(rows);
    const headers = headerIndex >= 0 ? buildHeaders(rows, headerIndex) : [];
    const startIndex = headerIndex >= 0 ? headerIndex + 1 : 0;
    for (let index = startIndex; index < rows.length; index += 1) {
      const row = rows[index] ?? [];
      if (isEmpty(row) || isHeaderContinuation(row)) continue;
      const rawValues = rowToObject(row, headers);
      const sourceRowNumber = index + 1;
      const sourceReference = `${sourceFileName}#${sheetName}!${sourceRowNumber}`;
      parsed.push({
        sheetName,
        sourceRowNumber,
        sourceReference,
        rowFingerprint: createHash('sha256')
          .update(`${sheetName}\0${sourceRowNumber}\0${stableStringify(rawValues)}`)
          .digest('hex'),
        rawValues,
        rawPreview: redactRawValues(rawValues),
        suggestions: classifyLegacyValues(rawValues),
      });
    }
  }
  return parsed;
}

export function classifyLegacyValues(values: Record<string, unknown>): LegacySuggestions {
  const entries = Object.entries(values);
  const get = (pattern: RegExp) => entries.find(([key]) => pattern.test(key))?.[1];
  const companyName = cleanText(get(/company.*name/i));
  const contactName = cleanText(get(/contact.*name/i));
  const emailText = cleanText(get(/e-?mail.*address/i));
  const emails = emailText?.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
  const technicalContact = cleanText(get(/it.*person|technical.*contact/i));
  const technicalEmail = technicalContact?.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
  const sourceRegistration = cleanText(get(/registration.*type/i));
  const sourcePackageName = cleanText(get(/\bpackage\b/i));
  const information = cleanText(redactValue(get(/information/i)));
  const normalizedInformation = normalize(information);
  const detectedServiceTypes = detectServiceTypes(normalizedInformation);
  const sourceServiceType = sourceRegistration
    ? SERVICE_TYPES.get(normalize(sourceRegistration))
    : undefined;
  const catalogMatch = findCatalogMatch(sourcePackageName);
  const matchedRules: string[] = [];
  const conflicts: string[] = [];

  if (sourceServiceType)
    matchedRules.push(`Registration maps to ${sourceServiceType} (hint only).`);
  if (catalogMatch) matchedRules.push(`Package label exactly matches ${catalogMatch.name}.`);
  if (detectedServiceTypes.length) {
    matchedRules.push(`Information indicates: ${detectedServiceTypes.join(', ')}.`);
  }
  if (catalogMatch && sourceServiceType && catalogMatch.serviceType !== sourceServiceType) {
    conflicts.push(
      `Registration says ${sourceServiceType}, but package label says ${catalogMatch.serviceType}.`,
    );
  }
  const strongestServiceType =
    detectedServiceTypes.length === 1
      ? detectedServiceTypes[0]
      : (catalogMatch?.serviceType ?? sourceServiceType);
  if (
    detectedServiceTypes.length === 1 &&
    sourceServiceType &&
    detectedServiceTypes[0] !== sourceServiceType
  ) {
    conflicts.push(
      `Registration says ${sourceServiceType}, but technical information indicates ${detectedServiceTypes[0]}.`,
    );
  }
  if (detectedServiceTypes.length > 1) {
    conflicts.push(
      'Information contains evidence for multiple service types; human split/merge decision required.',
    );
  }
  if (
    catalogMatch &&
    detectedServiceTypes.length === 1 &&
    detectedServiceTypes[0] !== catalogMatch.serviceType
  ) {
    conflicts.push(
      `Package label says ${catalogMatch.serviceType}, but technical information indicates ${detectedServiceTypes[0]}.`,
    );
  }
  if (catalogMatch?.expected) {
    conflicts.push(...compareTechnicalFacts(catalogMatch, normalizedInformation));
  }
  if (
    catalogMatch?.code === 'SSL_SINGLE' &&
    /wildcard|all(?: your)? sub[- ]?domains|every sub[- ]?domain|domain (?:&|and) sub[- ]?domain/.test(
      normalizedInformation,
    )
  ) {
    conflicts.push(
      'Information describes wildcard/subdomain SSL but the package label is single-domain SSL.',
    );
  }

  let classificationStatus: LegacySuggestions['classificationStatus'] = 'MANUAL_REVIEW';
  let servicePackageCode: string | undefined;
  let servicePackageName: string | undefined;
  if (catalogMatch && conflicts.length === 0) {
    classificationStatus = 'MATCHED_OFFICIAL';
    servicePackageCode = catalogMatch.code;
    servicePackageName = catalogMatch.name;
  } else if (
    isExplicitCustom(sourcePackageName) &&
    strongestServiceType &&
    conflicts.length === 0
  ) {
    classificationStatus = 'CUSTOM';
    servicePackageCode = `CUSTOM_${toServiceCode(strongestServiceType)}`;
    servicePackageName = `Custom (${strongestServiceType})`;
    matchedRules.push('Source package is explicitly custom; human confirmation is still required.');
  }

  const frequencyText = cleanText(get(/renwal.*frequancy|renewal.*frequency/i));
  const renewalIntervalMonths = parseTermMonths(frequencyText);
  const sourceStartDate = toIsoDate(get(/start\s*date/i));
  const sourceEndDate = toIsoDate(get(/end\s*date/i));
  const sourceRenewalReminderDate = toIsoDate(get(/renewal.*date/i));
  const priceJod = parseMoney(get(/price.*jd/i));
  const priceUsd = parseMoney(get(/price.*usd/i));
  const originalAmountFromColumn = parseMoney(
    get(/original.*subscription.*amount|subscription.*amount|original.*amount/i),
  );
  const originalCurrencyTextFromColumn = cleanText(
    get(/original.*subscription.*currency|subscription.*currency|original.*currency|\bcurrency\b/i),
  )?.toUpperCase();
  const originalCurrencyFromColumn = /^[A-Z]{3}$/.test(originalCurrencyTextFromColumn ?? '')
    ? originalCurrencyTextFromColumn
    : undefined;
  let originalAmount = originalAmountFromColumn;
  let originalCurrency = originalCurrencyFromColumn;
  if (originalAmount === undefined && originalCurrency === undefined) {
    // Some workbooks combine the original amount and currency into one free-text cell, e.g.
    // "real price" = "1250 SAR". Only used when no dedicated amount/currency columns exist at all.
    const realPriceMatch = cleanText(get(/real.*price/i))?.match(
      /^([\d,]+(?:\.\d{1,3})?)\s*([A-Za-z]{3})$/,
    );
    const [, realPriceAmountText, realPriceCurrencyText] = realPriceMatch ?? [];
    if (realPriceAmountText && realPriceCurrencyText) {
      originalAmount = parseMoney(realPriceAmountText);
      originalCurrency = realPriceCurrencyText.toUpperCase();
    }
  }
  const issues = [...conflicts];
  if (!companyName) issues.push('Missing or ambiguous company name.');
  if (!emails[0]) issues.push('Missing valid primary email.');
  if (!cleanText(get(/billing.*company/i))) issues.push('Billing Entity requires confirmation.');
  if (!strongestServiceType) issues.push('Service Type is missing or ambiguous.');
  if (!servicePackageCode) issues.push('Package requires human classification.');
  issues.push(...validateSourceDates(sourceStartDate, sourceEndDate, renewalIntervalMonths));
  if ((originalAmount === undefined) !== (originalCurrency === undefined)) {
    issues.push('Original subscription amount and currency must both be provided.');
  } else if (originalAmount === undefined && priceJod === undefined && priceUsd === undefined) {
    issues.push('Selling price and currency require human confirmation.');
  } else if (originalAmount === undefined && priceJod !== undefined && priceUsd !== undefined) {
    issues.push('Both JOD and USD price values are present; currency requires human confirmation.');
  }
  if (!renewalIntervalMonths) issues.push('Renewal interval requires human confirmation.');
  if (classificationStatus !== 'MATCHED_OFFICIAL') {
    issues.push('Classification requires explicit human approval.');
  }

  const domains = extractDomains([information, sourcePackageName, cleanText(get(/domain/i))]);
  return {
    companyName,
    contactName,
    primaryEmail: emails[0]?.toLowerCase(),
    secondaryEmail: emails[1]?.toLowerCase(),
    phone: cleanText(get(/\btel\b|phone/i)),
    address: cleanText(get(/\baddress\b/i)),
    billingEntityName: cleanText(get(/billing.*company/i)),
    sourceRegistration,
    sourcePackageName,
    serviceTypeName: strongestServiceType,
    servicePackageCode,
    servicePackageName,
    classificationStatus,
    classificationEvidence: {
      sourceRegistration,
      sourcePackageName,
      information,
      detectedServiceTypes,
      matchedPackageCode: catalogMatch?.code,
      matchedRules,
      conflicts,
    },
    sourceStartDate,
    sourceEndDate,
    sourceRenewalReminderDate,
    startDate: sourceStartDate,
    renewalDate: sourceEndDate,
    sellingPrice: originalAmount ?? priceJod ?? priceUsd,
    currency:
      originalAmount !== undefined && originalCurrency
        ? originalCurrency
        : priceJod !== undefined && priceUsd === undefined
          ? 'JOD'
          : priceUsd !== undefined && priceJod === undefined
            ? 'USD'
            : undefined,
    billingFrequency: intervalToFrequency(renewalIntervalMonths),
    renewalIntervalMonths,
    description: information,
    identifiers: domains.map((value) => ({ type: 'DOMAIN' as const, value })),
    contacts: [
      ...(contactName || emails[0]
        ? [{ role: 'PRIMARY' as const, name: contactName, email: emails[0]?.toLowerCase() }]
        : []),
      ...(technicalContact
        ? [
            {
              role: 'TECHNICAL' as const,
              name: technicalContact,
              email: technicalEmail?.toLowerCase(),
            },
          ]
        : []),
    ],
    issues: [...new Set(issues)],
  };
}

export function redactRawValues(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      SENSITIVE_LABEL.test(key) ? '[REDACTED]' : redactValue(value),
    ]),
  );
}

function detectServiceTypes(text: string): string[] {
  const result = new Set<string>();
  if (/ssl|certificate|wildcard/.test(text)) result.add('SSL');
  if (/dedicated|\b[248]x power\b|\b(?:linux|windows)\b.*\b(?:ram|cpu|core)\b/.test(text))
    result.add('Dedicated Server');
  if (/hosting|web space|mail space|plesk|monthly transfer/.test(text)) result.add('Hosting');
  if (/support ticket|support plan|vip support/.test(text)) result.add('Support');
  if (/antivirus|anti-virus/.test(text)) result.add('Antivirus');
  if (/dns hosting|dns zone|nameserver/.test(text)) result.add('DNS Hosting');
  if (/app subscription|application subscription|software subscription/.test(text))
    result.add('App Subscription');
  if (/domain registration|domain renewal/.test(text) && result.size === 0) result.add('Domain');
  return [...result];
}

function compareTechnicalFacts(catalog: CatalogSignature, text: string): string[] {
  const result: string[] = [];
  const expected = catalog.expected;
  if (!expected) return result;
  const web = numberNear(text, /web(?:site)?(?:\s+space)?/);
  const mail = numberNear(text, /(?:mail|email)(?:\s+space)?/);
  const ram = numberNear(text, /ram/);
  const cpu = numberBeforeLabel(text, /(?:core|cores)(?:\s*cpu)?/);
  const storage = numberNear(text, /storage(?:\s+ssd)?/);
  const transferGb = transferInGb(text);
  if (web !== undefined && expected.webSpaceGb !== undefined && web !== expected.webSpaceGb) {
    result.push(
      `Information says ${web}GB web space; ${catalog.name} specifies ${expected.webSpaceGb}GB.`,
    );
  }
  if (mail !== undefined && expected.mailSpaceGb !== undefined && mail !== expected.mailSpaceGb) {
    result.push(
      `Information says ${mail}GB mail space; ${catalog.name} specifies ${expected.mailSpaceGb}GB.`,
    );
  }
  if (ram !== undefined && expected.ramGb !== undefined && ram !== expected.ramGb) {
    result.push(`Information says ${ram}GB RAM; ${catalog.name} specifies ${expected.ramGb}GB.`);
  }
  if (cpu !== undefined && expected.cpuCores !== undefined && cpu !== expected.cpuCores) {
    result.push(
      `Information says ${cpu} CPU cores; ${catalog.name} specifies ${expected.cpuCores}.`,
    );
  }
  if (
    storage !== undefined &&
    expected.storageSsdGb !== undefined &&
    storage !== expected.storageSsdGb
  ) {
    result.push(
      `Information says ${storage}GB storage; ${catalog.name} specifies ${expected.storageSsdGb}GB.`,
    );
  }
  if (
    transferGb !== undefined &&
    expected.monthlyTransferGb !== undefined &&
    transferGb !== expected.monthlyTransferGb
  ) {
    result.push(
      `Information says ${transferGb}GB monthly transfer; ${catalog.name} specifies ${expected.monthlyTransferGb}GB.`,
    );
  }
  if (expected.mailSpaceGb && /no\s+(?:e-?mail|mail)\s+space/.test(text)) {
    result.push(
      `Information says no mail space; ${catalog.name} specifies ${expected.mailSpaceGb}GB.`,
    );
  }
  if (expected.webSpaceGb && /unlimited\s+(?:web\s+)?(?:space|storage)/.test(text)) {
    result.push(
      `Information says unlimited web storage; ${catalog.name} specifies ${expected.webSpaceGb}GB.`,
    );
  }
  if ((expected.webSpaceGb || expected.mailSpaceGb) && /\bextra\b/.test(text)) {
    result.push(
      'Information includes extra capacity beyond the catalog package; snapshot confirmation is required.',
    );
  }
  if (expected.os && /\b(?:linux|windows)\b/.test(text) && !text.includes(expected.os)) {
    result.push(`Information operating system conflicts with ${catalog.name}.`);
  }
  return result;
}

function transferInGb(text: string): number | undefined {
  const match = text.match(/monthly\s+transfer[^0-9]{0,12}(\d+(?:\.\d+)?)\s*(gb|tb)/i);
  if (!match) return undefined;
  return Number(match[1]) * (match[2]?.toLowerCase() === 'tb' ? 1024 : 1);
}

function numberBeforeLabel(text: string, label: RegExp): number | undefined {
  const match = text.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${label.source}`, 'i'));
  return match ? Number(match[1]) : undefined;
}

function numberNear(text: string, label: RegExp, gigabytes = true): number | undefined {
  const unit = gigabytes ? '\\s*gb' : '';
  const after = text.match(new RegExp(`${label.source}[^0-9]{0,12}(\\d+(?:\\.\\d+)?)${unit}`, 'i'));
  if (after) return Number(after[1]);
  const before = text.match(
    new RegExp(`(\\d+(?:\\.\\d+)?)${unit}[^a-z0-9]{0,8}${label.source}`, 'i'),
  );
  return before ? Number(before[1]) : undefined;
}

function findCatalogMatch(value?: string): CatalogSignature | undefined {
  if (!value) return undefined;
  const normalized = normalize(value);
  return CATALOG.find((entry) => entry.aliases.includes(normalized));
}

function isExplicitCustom(value?: string): boolean {
  if (!value) return false;
  const normalized = normalize(value);
  return (
    /^(custom|special|bespoke)(?:\s|$)/.test(normalized) &&
    !CATALOG.some((entry) => entry.aliases.includes(normalized))
  );
}

function parseTermMonths(value?: string): number | undefined {
  if (!value) return undefined;
  const normalized = normalize(value);
  const years = normalized.match(/(\d+)\s*(?:year|years|yr|yrs)/)?.[1];
  if (years) return Number(years) * 12;
  const months = normalized.match(/(\d+)\s*(?:month|months|mo)/)?.[1];
  if (months) return Number(months);
  if (/annual|yearly/.test(normalized)) return 12;
  if (/biennial/.test(normalized)) return 24;
  return undefined;
}

function intervalToFrequency(months?: number): string | undefined {
  return months === 1
    ? 'MONTHLY'
    : months === 3
      ? 'QUARTERLY'
      : months === 6
        ? 'SEMI_ANNUAL'
        : months === 12
          ? 'ANNUAL'
          : months === 24
            ? 'BIENNIAL'
            : months
              ? 'CUSTOM'
              : undefined;
}

function validateSourceDates(
  startDate: string | undefined,
  endDate: string | undefined,
  renewalIntervalMonths: number | undefined,
): string[] {
  const issues: string[] = [];
  if (!startDate) {
    issues.push('Start Date column is missing or invalid; human confirmation is required.');
  }
  if (!endDate) {
    issues.push('End Date column is missing or invalid; human confirmation is required.');
  }
  if (!startDate || !endDate) return issues;
  if (startDate >= endDate) {
    issues.push('Start Date must be earlier than End Date; human correction is required.');
    return issues;
  }
  if (renewalIntervalMonths && inclusiveTermStart(endDate, renewalIntervalMonths) !== startDate) {
    issues.push(
      'Start Date and End Date do not match the recorded renewal interval; human confirmation is required.',
    );
  }
  return issues;
}

function inclusiveTermStart(endDate: string, months: number): string {
  const date = new Date(`${endDate}T00:00:00.000Z`);
  const originalDay = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - months);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(originalDay, lastDay) + 1);
  return date.toISOString().slice(0, 10);
}

function extractDomains(values: Array<string | undefined>): string[] {
  const result = new Set<string>();
  for (const value of values) {
    for (const match of value?.match(/(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}/gi) ??
      []) {
      result.add(match.toLowerCase().replace(/^www\./, ''));
    }
  }
  return [...result];
}

function toServiceCode(name: string): string {
  return name.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
}

function normalize(value?: string): string {
  return (value ?? '')
    .normalize('NFKC')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function cleanText(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const result = String(value).trim();
  return result || undefined;
}

function parseMoney(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value.toFixed(3);
  if (typeof value !== 'string') return undefined;
  const normalized = value.replace(/,/g, '').trim();
  return /^\d+(?:\.\d{1,3})?$/.test(normalized) ? normalized : undefined;
}

function toIsoDate(value: unknown): string | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return localCalendarDate(value);
  if (typeof value === 'string') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString().slice(0, 10);
  }
  if (typeof value === 'number' && value > 0 && value < 2_958_466) {
    const date = new Date(Math.round((value - 25_569) * 86_400_000));
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString().slice(0, 10);
  }
  return undefined;
}

function localCalendarDate(value: Date): string {
  const year = String(value.getFullYear()).padStart(4, '0');
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function findHeaderRow(rows: unknown[][]): number {
  const max = Math.min(rows.length, 25);
  for (let index = 0; index < max; index += 1) {
    const row = rows[index] ?? [];
    const score = row.filter(
      (value) => typeof value === 'string' && EXPECTED_HEADER.test(value),
    ).length;
    if (score >= 4) return index;
  }
  return -1;
}

function buildHeaders(rows: unknown[][], headerIndex: number): string[] {
  const first = rows[headerIndex] ?? [];
  const second = rows[headerIndex + 1] ?? [];
  const secondIsHeader = isHeaderContinuation(second);
  const length = Math.max(first.length, secondIsHeader ? second.length : 0);
  return Array.from({ length }, (_, index) => {
    const parts = [first[index], secondIsHeader ? second[index] : undefined]
      .filter((value) => typeof value === 'string' && value.trim())
      .map((value) => String(value).trim());
    return parts.join(' ').trim();
  });
}

function isHeaderContinuation(row: unknown[]): boolean {
  if (isEmpty(row)) return false;
  const text = row.map((value) => displayCell(value).trim().toLowerCase());
  const tokens = ['date (-15days)', 'frequancy', 'customer', 'name', 'address', 'type', 'value'];
  return tokens.filter((token) => text.some((value) => value === token)).length >= 3;
}

function isEmpty(row: unknown[]): boolean {
  return row.every((value) => displayCell(value).trim() === '');
}

function rowToObject(row: unknown[], headers: string[]): Record<string, unknown> {
  return Object.fromEntries(
    row.map((value, index) => {
      const column = XLSX.utils.encode_col(index);
      const header = headers[index];
      return [`${column}${header ? ` — ${header}` : ''}`, normalizeValue(value)];
    }),
  );
}

function normalizeValue(value: unknown): unknown {
  if (value instanceof Date) return localCalendarDate(value);
  if (typeof value === 'number' && !Number.isFinite(value)) return String(value);
  return value;
}

function redactValue(value: unknown): unknown {
  if (typeof value !== 'string') return value instanceof Date ? localCalendarDate(value) : value;
  return value
    .replace(
      /(^|\n)\s*(user(?:name)?|login|pass(?:word)?|token|secret|credential|api.?key)\s*[:=]\s*[^\r\n]*/gi,
      '$1$2: [REDACTED]',
    )
    .slice(0, 4000);
}

function displayCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return localCalendarDate(value);
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  return JSON.stringify(value) ?? '';
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
