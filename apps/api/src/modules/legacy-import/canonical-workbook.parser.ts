import * as XLSX from '@e965/xlsx';
import type { ChannelVerificationStatus, PhoneType } from '../../generated/prisma/enums';

// Parses the "CRM_Import_Schema" canonical workbook format: a pre-reviewed, pre-normalized,
// multi-sheet relational export (Customers / Contacts / Phone_Channels / Email_Channels /
// Subscriptions / Subscription_Identifiers) rather than one flat sheet of raw legacy rows. Every
// value here has already been through the external review process the workbook documents in its
// own README/Review_Issues sheets; this parser's job is structural extraction and validation, not
// re-deriving normalization decisions that were already made and approved.

export interface CanonicalPhoneChannel {
  phoneId: string;
  contactRef?: string;
  phoneType: PhoneType;
  rawValue?: string;
  country?: string;
  countryCallingCode: string;
  areaOrOperatorCode?: string;
  subscriberNumber?: string;
  phoneNumber: string;
  extension?: string;
  active: boolean;
  primary: boolean;
  verificationStatus: ChannelVerificationStatus;
  holderName?: string;
  metadata: Record<string, unknown>;
}

export interface CanonicalEmailChannel {
  emailId: string;
  contactRef?: string;
  email: string;
  role: string;
  verificationStatus: ChannelVerificationStatus;
  holderName?: string;
}

export interface CanonicalContact {
  contactId: string;
  personName?: string;
  role: string;
}

export interface CanonicalCustomer {
  customerId: string;
  sourceSequence: number;
  firstSourceRow?: number;
  companyName: string;
  address?: string;
  country?: string;
  billingEntityName?: string;
  reviewStatus: string;
  contacts: CanonicalContact[];
  phones: CanonicalPhoneChannel[];
  emails: CanonicalEmailChannel[];
}

export interface CanonicalIdentifier {
  type: 'DOMAIN';
  value: string;
}

export interface CanonicalSubscriptionRow {
  subscriptionId: string;
  sourceSequence?: number;
  sourceRow?: number;
  customerId: string;
  billingEntitySource?: string;
  serviceTypeSource?: string;
  packageSource?: string;
  startDate?: string;
  currentTermEndDate?: string;
  legacyReminderDate?: string;
  renewalIntervalMonths?: number;
  paidLabel?: string;
  sellingPriceOriginal?: string;
  currency?: string;
  informationSource?: string;
  reviewStatus: string;
  identifiers: CanonicalIdentifier[];
}

export interface ParsedCanonicalWorkbook {
  customers: Map<string, CanonicalCustomer>;
  subscriptions: CanonicalSubscriptionRow[];
}

const REQUIRED_SHEETS = [
  'Customers',
  'Contacts',
  'Phone_Channels',
  'Email_Channels',
  'Subscriptions',
];

export function parseCanonicalWorkbook(buffer: Buffer): ParsedCanonicalWorkbook {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true, dense: true });
  for (const name of REQUIRED_SHEETS) {
    if (!workbook.SheetNames.includes(name)) {
      throw new Error(`The canonical workbook is missing the required "${name}" sheet.`);
    }
  }

  const customerRows = sheetToObjects(workbook, 'Customers');
  const contactRows = sheetToObjects(workbook, 'Contacts');
  const phoneRows = sheetToObjects(workbook, 'Phone_Channels');
  const emailRows = sheetToObjects(workbook, 'Email_Channels');
  const subscriptionRows = sheetToObjects(workbook, 'Subscriptions');
  const identifierRows = workbook.SheetNames.includes('Subscription_Identifiers')
    ? sheetToObjects(workbook, 'Subscription_Identifiers')
    : [];

  const customers = new Map<string, CanonicalCustomer>();
  for (const row of customerRows) {
    const customerId = text(row.Customer_ID);
    if (!customerId) continue;
    customers.set(customerId, {
      customerId,
      sourceSequence: Number(row.Customer_Order) || 0,
      firstSourceRow: numberOrUndefined(row.First_Source_Row),
      companyName: text(row.Canonical_Name) ?? `Customer ${customerId}`,
      address: text(row.Address_Values),
      country: text(row.Country_Context),
      billingEntityName: text(row.Billing_Entities_Seen),
      reviewStatus: text(row.Review_Status) ?? 'READY',
      contacts: [],
      phones: [],
      emails: [],
    });
  }

  const contactCustomerById = new Map<string, string>();
  for (const row of contactRows) {
    const contactId = text(row.Contact_ID);
    const customerId = text(row.Customer_ID);
    if (!contactId || !customerId) continue;
    const customer = customers.get(customerId);
    if (!customer) continue;
    contactCustomerById.set(contactId, customerId);
    customer.contacts.push({
      contactId,
      personName: text(row.Person_Name),
      role: normalizeRole(text(row.Role)),
    });
  }

  for (const row of phoneRows) {
    const customerId = text(row.Customer_ID);
    const phoneId = text(row.Phone_ID);
    const e164 = text(row.E164_Normalized);
    if (!customerId || !phoneId || !e164) continue;
    const customer = customers.get(customerId);
    if (!customer) continue;
    const countryCallingCode = e164.match(/^\+\d{1,3}/)?.[0] ?? '+962';
    customer.phones.push({
      phoneId,
      contactRef: text(row.Contact_ID) || undefined,
      phoneType: normalizePhoneType(text(row.Phone_Type)),
      rawValue: text(row.Raw_Phone),
      country: text(row.Country),
      countryCallingCode: text(row.Country_Calling_Code) || countryCallingCode,
      areaOrOperatorCode: text(row.Area_Operator_Code),
      subscriberNumber: text(row.Subscriber_Number),
      phoneNumber: e164,
      extension: text(row.Extension),
      active: row.Active !== false && row.Active !== 'false' && row.Active !== 'FALSE',
      primary:
        row.Primary_Draft === true || row.Primary_Draft === 'true' || row.Primary_Draft === 'TRUE',
      verificationStatus: normalizeVerification(text(row.Verification_Status)),
      holderName: contactNameFor(customer, text(row.Contact_ID)),
      metadata: compact({
        normalizationMethod: text(row.Normalization_Method),
        confidence: text(row.Confidence),
        evidence: text(row.Evidence),
        sourceUrl: text(row.Source_URL),
        parserNotes: text(row.Parser_Notes),
        sourceRows: text(row.Source_Rows),
      }),
    });
  }

  for (const row of emailRows) {
    const customerId = text(row.Customer_ID);
    const emailId = text(row.Email_ID);
    const email = text(row.Normalized_Email) ?? text(row.Raw_Email);
    if (!customerId || !emailId || !email) continue;
    const customer = customers.get(customerId);
    if (!customer) continue;
    customer.emails.push({
      emailId,
      contactRef: text(row.Contact_ID) || undefined,
      email: email.toLowerCase(),
      role: normalizeRole(text(row.Role)),
      verificationStatus: normalizeVerification(text(row.Verification_Status)),
      holderName: contactNameFor(customer, text(row.Contact_ID)),
    });
  }

  const identifiersBySubscription = new Map<string, CanonicalIdentifier[]>();
  for (const row of identifierRows) {
    const subscriptionId = text(row.Subscription_ID);
    const value = text(row.Normalized_Value) ?? text(row.Raw_Value);
    if (!subscriptionId || !value) continue;
    const list = identifiersBySubscription.get(subscriptionId) ?? [];
    list.push({ type: 'DOMAIN', value: value.toLowerCase() });
    identifiersBySubscription.set(subscriptionId, list);
  }

  const subscriptions: CanonicalSubscriptionRow[] = [];
  for (const row of subscriptionRows) {
    const subscriptionId = text(row.Subscription_ID);
    const customerId = text(row.Customer_ID);
    if (!subscriptionId || !customerId || !customers.has(customerId)) continue;
    subscriptions.push({
      subscriptionId,
      sourceSequence: numberOrUndefined(row.Source_Sequence),
      sourceRow: numberOrUndefined(row.Source_Row),
      customerId,
      billingEntitySource: text(row.Billing_Entity_Source),
      serviceTypeSource: text(row.Service_Type_Source),
      packageSource: text(row.Package_Source),
      startDate: isoDate(row.Start_Date),
      currentTermEndDate: isoDate(row.Current_Term_End_Date),
      legacyReminderDate: isoDate(row.Legacy_Reminder_Date),
      renewalIntervalMonths: numberOrUndefined(row.Renewal_Interval_Months),
      paidLabel: text(row.Paid_Label_Source),
      sellingPriceOriginal: moneyText(row.Selling_Price_Original),
      currency: text(row.Currency)?.toUpperCase(),
      informationSource: text(row.Information_Source),
      reviewStatus: text(row.Review_Status) ?? 'READY',
      identifiers: identifiersBySubscription.get(subscriptionId) ?? [],
    });
  }
  subscriptions.sort((a, b) => (a.sourceSequence ?? 0) - (b.sourceSequence ?? 0));

  return { customers, subscriptions };
}

function contactNameFor(
  customer: CanonicalCustomer,
  contactId: string | undefined,
): string | undefined {
  if (!contactId) return undefined;
  return customer.contacts.find((contact) => contact.contactId === contactId)?.personName;
}

function normalizeRole(role: string | undefined): string {
  const normalized = (role ?? '').trim().toUpperCase();
  return normalized === 'TECHNICAL' ? 'TECHNICAL' : 'OTHER';
}

function normalizePhoneType(value: string | undefined): PhoneType {
  const normalized = (value ?? '').trim().toUpperCase();
  if (normalized === 'MOBILE' || normalized === 'LANDLINE' || normalized === 'FAX') {
    return normalized;
  }
  return 'PHONE';
}

function normalizeVerification(value: string | undefined): ChannelVerificationStatus {
  const normalized = (value ?? '').trim().toUpperCase();
  if (normalized === 'VERIFIED' || normalized === 'INVALID') {
    return normalized;
  }
  return 'UNVERIFIED';
}

function sheetToObjects(
  workbook: XLSX.WorkBook,
  sheetName: string,
): Array<Record<string, unknown>> {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: null,
    raw: true,
    blankrows: false,
  });
  const headers = (rows[0] ?? []).map((value) => cellToText(value).trim());
  return rows
    .slice(1)
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? null])));
}

function cellToText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value instanceof Date) return value.toISOString();
  return '';
}

function text(value: unknown): string | undefined {
  const result = cellToText(value).trim();
  return result || undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  const num = Number(value);
  return Number.isFinite(num) && cellToText(value).trim() !== '' ? num : undefined;
}

function moneyText(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value.toFixed(3);
  const cleaned = text(value)?.replace(/,/g, '');
  return cleaned && /^\d+(?:\.\d{1,3})?$/.test(cleaned) ? cleaned : undefined;
}

function isoDate(value: unknown): string | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = String(value.getFullYear()).padStart(4, '0');
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  if (typeof value === 'string') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString().slice(0, 10);
  }
  return undefined;
}

function compact<T extends Record<string, unknown>>(value: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}
