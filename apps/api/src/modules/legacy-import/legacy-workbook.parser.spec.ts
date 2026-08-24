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
