import * as XLSX from '@e965/xlsx';
import { parseCanonicalWorkbook } from './canonical-workbook.parser';
import { detectCanonicalWorkbook } from './legacy-workbook.parser';

function sheet(rows: unknown[][]) {
  return XLSX.utils.aoa_to_sheet(rows);
}

function buildWorkbook(): Buffer {
  const workbook = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    workbook,
    sheet([
      [
        'Customer_ID',
        'Customer_Order',
        'First_Source_Row',
        'Canonical_Name',
        'Address_Values',
        'Country_Context',
        'Billing_Entities_Seen',
        'Review_Status',
      ],
      ['CUST-0002', 2, 4, 'Second Customer', 'Address B', 'Jordan', 'Billing Co', 'READY'],
      ['CUST-0001', 1, 3, 'First Customer', 'Address A', 'Jordan', 'Billing Co', 'READY'],
    ]),
    'Customers',
  );

  XLSX.utils.book_append_sheet(
    workbook,
    sheet([
      ['Contact_ID', 'Customer_ID', 'Person_Name', 'Role'],
      ['CONT-0001', 'CUST-0001', 'Waseem Khalf', 'GENERAL'],
      ['CONT-0002', 'CUST-0001', 'Sara Hijjawi', 'TECHNICAL'],
    ]),
    'Contacts',
  );

  XLSX.utils.book_append_sheet(
    workbook,
    sheet([
      [
        'Phone_ID',
        'Customer_ID',
        'Contact_ID',
        'Phone_Type',
        'Raw_Phone',
        'Country',
        'Country_Calling_Code',
        'Area_Operator_Code',
        'Subscriber_Number',
        'E164_Normalized',
        'Active',
        'Primary_Draft',
        'Verification_Status',
      ],
      [
        'PH-0001',
        'CUST-0001',
        'CONT-0001',
        'MOBILE',
        '0799984747',
        'Jordan',
        '+962',
        '79',
        '9984747',
        '+962799984747',
        true,
        true,
        'UNVERIFIED',
      ],
      [
        'PH-0002',
        'CUST-0001',
        'CONT-0002',
        'MOBILE',
        '0798771216',
        'Jordan',
        '+962',
        '79',
        '8771216',
        '+962798771216',
        true,
        false,
        'UNVERIFIED',
      ],
      [
        'PH-0003',
        'CUST-0001',
        'CONT-0001',
        'LANDLINE',
        '+962 6 5539921',
        'Jordan',
        '+962',
        '6',
        '5539921',
        '+96265539921',
        true,
        false,
        'UNVERIFIED',
      ],
    ]),
    'Phone_Channels',
  );

  XLSX.utils.book_append_sheet(
    workbook,
    sheet([
      [
        'Email_ID',
        'Customer_ID',
        'Contact_ID',
        'Raw_Email',
        'Normalized_Email',
        'Role',
        'Verification_Status',
      ],
      [
        'EM-0001',
        'CUST-0001',
        'CONT-0001',
        'waseem@donuttery.shop',
        'waseem@donuttery.shop',
        'GENERAL',
        'UNVERIFIED',
      ],
      [
        'EM-0002',
        'CUST-0001',
        '',
        'pr@donuttery.shop',
        'pr@donuttery.shop',
        'GENERAL',
        'UNVERIFIED',
      ],
    ]),
    'Email_Channels',
  );

  XLSX.utils.book_append_sheet(
    workbook,
    sheet([
      [
        'Subscription_ID',
        'Source_Sequence',
        'Source_Row',
        'Customer_ID',
        'Billing_Entity_Source',
        'Service_Type_Source',
        'Package_Source',
        'Start_Date',
        'Current_Term_End_Date',
        'Legacy_Reminder_Date',
        'Renewal_Interval_Months',
        'Paid_Label_Source',
        'Selling_Price_Original',
        'Currency',
        'Information_Source',
        'Review_Status',
      ],
      [
        'SUB-0001',
        1,
        3,
        'CUST-0001',
        'Billing Co',
        'Hosting',
        'PREMIUM PLAN',
        new Date('2025-01-15T00:00:00.000Z'),
        new Date('2030-01-14T00:00:00.000Z'),
        new Date('2029-12-31T00:00:00.000Z'),
        60,
        'PAID 2025',
        875,
        'JOD',
        'PREMIUM PLAN:\ndonuttery.co\n•\tWeb Space 30GB\n•\tMail Space 8GB for emails',
        'READY',
      ],
    ]),
    'Subscriptions',
  );

  XLSX.utils.book_append_sheet(
    workbook,
    sheet([
      [
        'Identifier_ID',
        'Subscription_ID',
        'Customer_ID',
        'Identifier_Type',
        'Raw_Value',
        'Normalized_Value',
      ],
      ['ID-0001', 'SUB-0001', 'CUST-0001', 'DOMAIN', 'donuttery.co', 'donuttery.co'],
      ['ID-0002', 'SUB-0001', 'CUST-0001', 'DOMAIN', 'WWW.DONUTTERY.SHOP', 'donuttery.shop'],
    ]),
    'Subscription_Identifiers',
  );

  const output: unknown = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  if (Buffer.isBuffer(output)) return output;
  if (output instanceof Uint8Array) return Buffer.from(output);
  throw new Error('The XLSX writer returned an unexpected fixture type.');
}

describe('detectCanonicalWorkbook', () => {
  it('recognizes a canonical multi-sheet workbook by its sheet names', () => {
    expect(detectCanonicalWorkbook(buildWorkbook())).toBe(true);
  });
});

describe('parseCanonicalWorkbook', () => {
  const parsed = parseCanonicalWorkbook(buildWorkbook());

  it('preserves Customer_Order as the source sequence regardless of sheet row order', () => {
    const first = parsed.customers.get('CUST-0001');
    const second = parsed.customers.get('CUST-0002');
    expect(first?.sourceSequence).toBe(1);
    expect(second?.sourceSequence).toBe(2);
  });

  it('attaches multiple phone numbers to different named contacts of the same customer', () => {
    const customer = parsed.customers.get('CUST-0001');
    expect(customer?.phones).toHaveLength(3);
    expect(customer?.phones.map((phone) => phone.phoneNumber)).toEqual([
      '+962799984747',
      '+962798771216',
      '+96265539921',
    ]);
    expect(customer?.phones[0]?.contactRef).toBe('CONT-0001');
    expect(customer?.phones[1]?.contactRef).toBe('CONT-0002');
    expect(customer?.phones[0]?.primary).toBe(true);
    expect(customer?.phones[1]?.primary).toBe(false);
  });

  it('allows the same contact to have more than one phone number', () => {
    const customer = parsed.customers.get('CUST-0001');
    const waseemsPhones = customer?.phones.filter((phone) => phone.contactRef === 'CONT-0001');
    expect(waseemsPhones).toHaveLength(2);
    expect(waseemsPhones?.map((phone) => phone.phoneNumber)).toEqual([
      '+962799984747',
      '+96265539921',
    ]);
    expect(waseemsPhones?.map((phone) => phone.phoneType)).toEqual(['MOBILE', 'LANDLINE']);
  });

  it('captures multiple email channels per customer, with and without a named contact', () => {
    const customer = parsed.customers.get('CUST-0001');
    expect(customer?.emails).toHaveLength(2);
    expect(customer?.emails[0]).toMatchObject({
      email: 'waseem@donuttery.shop',
      contactRef: 'CONT-0001',
    });
    expect(customer?.emails[1]).toMatchObject({
      email: 'pr@donuttery.shop',
      contactRef: undefined,
    });
  });

  it('captures multiple domains for one subscription as independent identifiers', () => {
    const subscription = parsed.subscriptions.find((row) => row.subscriptionId === 'SUB-0001');
    expect(subscription?.identifiers).toEqual([
      { type: 'DOMAIN', value: 'donuttery.co' },
      { type: 'DOMAIN', value: 'donuttery.shop' },
    ]);
  });

  it('reads the original selling price/currency directly rather than any legacy JOD conversion', () => {
    const subscription = parsed.subscriptions.find((row) => row.subscriptionId === 'SUB-0001');
    expect(subscription).toMatchObject({ sellingPriceOriginal: '875.000', currency: 'JOD' });
  });

  it('exposes currentTermEndDate distinctly from the legacy reminder date', () => {
    const subscription = parsed.subscriptions.find((row) => row.subscriptionId === 'SUB-0001');
    expect(subscription?.currentTermEndDate).toBe('2030-01-14');
    expect(subscription?.legacyReminderDate).toBe('2029-12-31');
  });

  it('carries the legacy PAID label as evidence metadata only', () => {
    const subscription = parsed.subscriptions.find((row) => row.subscriptionId === 'SUB-0001');
    expect(subscription?.paidLabel).toBe('PAID 2025');
  });
});
