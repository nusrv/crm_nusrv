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

export interface LegacySuggestions {
  companyName?: string;
  contactName?: string;
  primaryEmail?: string;
  secondaryEmail?: string;
  phone?: string;
  address?: string;
  billingEntityName?: string;
  serviceTypeName?: string;
  renewalDate?: string;
  sellingPrice?: string;
  currency?: string;
  billingFrequency?: string;
  description?: string;
  issues: string[];
}

const EXPECTED_HEADER =
  /(renewal|company|e-?mail|registration|contact|address|billing|information)/i;
const SENSITIVE_LABEL = /(user(name)?|login|pass(word)?|token|secret|credential|api.?key)/i;
const EXACT_SERVICE_TYPES = new Map([
  ['domain', 'Domain'],
  ['ssl', 'SSL'],
  ['hosting', 'Hosting'],
  ['dedicated server', 'Dedicated Server'],
  ['support', 'Support'],
  ['antivirus', 'Antivirus'],
]);

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
        suggestions: suggestMapping(rawValues),
      });
    }
  }
  return parsed;
}

export function redactRawValues(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      SENSITIVE_LABEL.test(key) ? '[REDACTED]' : redactValue(value),
    ]),
  );
}

function redactValue(value: unknown): unknown {
  if (typeof value !== 'string') return value instanceof Date ? value.toISOString() : value;
  return value
    .replace(
      /(^|\n)\s*(user(?:name)?|login|pass(?:word)?|token|secret|credential|api.?key)\s*[:=]\s*[^\r\n]*/gi,
      '$1$2: [REDACTED]',
    )
    .slice(0, 4000);
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
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number' && !Number.isFinite(value)) return String(value);
  return value;
}

function suggestMapping(values: Record<string, unknown>): LegacySuggestions {
  const entries = Object.entries(values);
  const get = (pattern: RegExp) =>
    entries.find(([key]) => pattern.test(key))?.[1] as string | number | undefined;
  const company = cleanText(get(/company.*name/i));
  const contact = cleanText(get(/contact.*name/i));
  const emailText = cleanText(get(/e-?mail.*address/i));
  const emails = emailText?.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
  const phone = cleanText(get(/\btel\b/i));
  const address = cleanText(get(/\baddress\b/i));
  const billingEntityName = cleanText(get(/billing.*company/i));
  const registration = cleanText(get(/registration.*type/i));
  const serviceTypeName = registration
    ? EXACT_SERVICE_TYPES.get(registration.trim().toLowerCase())
    : undefined;
  const renewalDate = toIsoDate(get(/^A\b|renewal.*date/i));
  const priceJod = parseMoney(get(/price.*jd/i));
  const description = cleanText(redactValue(get(/information/i)));
  const frequencyText = cleanText(get(/renwal.*frequancy|renewal.*frequency/i));
  const issues: string[] = [];
  if (!company) issues.push('Missing or ambiguous company name.');
  if (!emails[0]) issues.push('Missing valid primary email.');
  if (!billingEntityName) issues.push('Billing Entity requires confirmation.');
  if (!serviceTypeName) issues.push('Service Type is missing or ambiguous.');
  issues.push(
    'Start date requires human confirmation; it is not safely normalized from free text.',
  );
  if (!renewalDate) issues.push('Renewal date requires human confirmation.');
  if (priceJod === undefined) issues.push('Selling price and currency require human confirmation.');
  return {
    companyName: company,
    contactName: contact,
    primaryEmail: emails[0]?.toLowerCase(),
    secondaryEmail: emails[1]?.toLowerCase(),
    phone,
    address,
    billingEntityName,
    serviceTypeName,
    renewalDate,
    sellingPrice: priceJod,
    currency: priceJod === undefined ? undefined : 'JOD',
    billingFrequency: frequencyText ? 'CUSTOM' : undefined,
    description,
    issues,
  };
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
  if (value instanceof Date && !Number.isNaN(value.getTime()))
    return value.toISOString().slice(0, 10);
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

function displayCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
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
