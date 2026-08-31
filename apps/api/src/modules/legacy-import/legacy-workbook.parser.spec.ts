import * as XLSX from '@e965/xlsx';
import { parseLegacyWorkbook, redactRawValues } from './legacy-workbook.parser';

function safeWorkbookFixture(): Buffer {
  const workbook = XLSX.utils.book_new();
  const headers = [
    'Renewal Date',
    'Company Name',
    'E-mail Address',
    'Registration Type',
    'Contact Name',
    'Billing Company',
    'Price JD',
    'Information',
  ];
  for (const sheetName of ['Active_Subscriptions', 'Suspended_Subscriptions']) {
    const rows: unknown[][] = [headers];
    for (let index = 1; index <= 55; index += 1) {
      rows.push([
        '2027-01-01',
        `SAFE TEST COMPANY ${sheetName} ${index}`,
        `safe-${index}@example.test`,
        index === 1 ? 'Hosting + Email' : 'Hosting',
        'Safe Test Contact',
        'New Serve for Digital Data Transformation',
        100 + index,
        'Synthetic parser fixture; no customer or credential data.',
      ]);
    }
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), sheetName);
  }
  const output: unknown = XLSX.write(workbook, { type: 'buffer', bookType: 'xls' });
  if (Buffer.isBuffer(output)) return output;
  if (output instanceof Uint8Array) return Buffer.from(output);
  throw new Error('The XLS writer returned an unexpected fixture type.');
}

function explicitDateWorkbookFixture(): Buffer {
  const workbook = XLSX.utils.book_new();
  const rows: unknown[][] = [
    [
      'Start',
      'End',
      'Renewal',
      'Renwal',
      'Company',
      'E-mail',
      'Registration',
      'Package',
      'Billing',
      'Information',
      'Price',
    ],
    [
      'Date',
      'Date',
      'date (-15days)',
      'Frequancy',
      'name',
      'address',
      'type',
      '',
      'Company',
      '',
      'JD',
    ],
    [
      new Date('2026-01-16T00:00:00Z'),
      new Date('2027-01-15T00:00:00Z'),
      new Date('2026-12-31T00:00:00Z'),
      '1 Year',
      'SAFE DATED COMPANY',
      'safe-dated@example.test',
      'Hosting',
      'PREMIUM PLAN',
      'New Serve for Digital Data Transformation',
      'Web Space 30GB; Mail Space 8GB; Monthly Transfer 250GB',
      250,
    ],
  ];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Active_Subscriptions');
  const output: unknown = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  if (Buffer.isBuffer(output)) return output;
  if (output instanceof Uint8Array) return Buffer.from(output);
  throw new Error('The XLSX writer returned an unexpected fixture type.');
}

function originalCurrencyWorkbookFixture(): Buffer {
  const workbook = XLSX.utils.book_new();
  const rows: unknown[][] = [
    [
      'Start',
      'End',
      'Renewal',
      'Renwal',
      'Company',
      'E-mail',
      'Registration',
      'Package',
      'Billing',
      'Original Subscription',
      'Original Subscription',
      'Price',
      'Price',
    ],
    [
      'Date',
      'Date',
      'date (-15days)',
      'Frequancy',
      'name',
      'address',
      'type',
      '',
      'Company',
      'Amount',
      'Currency',
      'JD',
      'USD',
    ],
    [
      new Date('2026-01-16T00:00:00Z'),
      new Date('2027-01-15T00:00:00Z'),
      new Date('2026-12-31T00:00:00Z'),
      '1 Year',
      'SAFE CURRENCY COMPANY',
      'safe-currency@example.test',
      'Hosting',
      'PREMIUM PLAN',
      'New Serve for Digital Data Transformation',
      1000,
      'USD',
      710,
      1000,
    ],
  ];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Active_Subscriptions');
  const output: unknown = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  if (Buffer.isBuffer(output)) return output;
  if (output instanceof Uint8Array) return Buffer.from(output);
  throw new Error('The XLSX writer returned an unexpected fixture type.');
}

describe('legacy workbook parser', () => {
  it('stages a safe XLS fixture with source references and conservative manual-review suggestions', () => {
    const rows = parseLegacyWorkbook(safeWorkbookFixture(), 'safe-legacy-fixture.xls');
    const sheets = new Set(rows.map((row) => row.sheetName));
    expect(rows.length).toBeGreaterThan(100);
    expect(sheets.has('Active_Subscriptions')).toBe(true);
    expect(sheets.has('Suspended_Subscriptions')).toBe(true);
    expect(rows.every((row) => row.sourceReference.includes(`#${row.sheetName}!`))).toBe(true);
    expect(
      rows.some((row) => row.suggestions.issues.some((issue) => /ambiguous/i.test(issue))),
    ).toBe(true);
    expect(
      rows.every((row) => row.suggestions.issues.some((issue) => /Start date/i.test(issue))),
    ).toBe(true);
  });

  it('combines the two-row headers and prefills explicit Start and End dates', () => {
    const rows = parseLegacyWorkbook(explicitDateWorkbookFixture(), 'dated.xlsx');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.suggestions).toMatchObject({
      sourceStartDate: '2026-01-16',
      sourceEndDate: '2027-01-15',
      sourceRenewalReminderDate: '2026-12-31',
      startDate: '2026-01-16',
      renewalDate: '2027-01-15',
      renewalIntervalMonths: 12,
    });
    expect(rows[0]?.suggestions.issues.join(' ')).not.toMatch(
      /Start Date column|End Date column|do not match/i,
    );
  });

  it('prefers an explicit Original Subscription Amount/Currency over the legacy Price JD/USD columns', () => {
    const rows = parseLegacyWorkbook(originalCurrencyWorkbookFixture(), 'currency.xlsx');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.suggestions).toMatchObject({
      sellingPrice: '1000.000',
      currency: 'USD',
    });
    expect(rows[0]?.suggestions.issues.join(' ')).not.toMatch(
      /Selling price and currency require human confirmation|Both JOD and USD/i,
    );
  });

  it('redacts credentials embedded inside otherwise unnamed free-text cells', () => {
    const preview = redactRawValues({
      A: 'Host: example.test\nUsername: operator\nPass: do-not-expose',
      password: 'also-secret',
    });
    const serialized = JSON.stringify(preview);
    expect(serialized).toContain('[REDACTED]');
    expect(serialized).not.toContain('operator');
    expect(serialized).not.toContain('do-not-expose');
    expect(serialized).not.toContain('also-secret');
  });
});
