import { FawtaraMapper } from './fawtara-mapper';
import { fixture } from './jofotara-test-fixture';
import { parseOfficialValues } from './official-values';
import { officialQrImage } from './official-qr';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
describe('ISTD mapper', () => {
  const mapper = new FawtaraMapper();
  it('matches reviewed general-sales golden XML and exact base64/hash', () => {
    const mapped = mapper.map(fixture(), '9932895');
    expect(mapped.xml).toBe(
      readFileSync(
        join(process.cwd(), 'src/modules/invoices/fixtures/general-receivable.xml'),
        'utf8',
      ).trim(),
    );
    expect(Buffer.from(mapped.encodedUblInvoice, 'base64').toString('utf8')).toBe(mapped.xml);
    expect(mapped.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(mapped.xml).toContain(
      '<cbc:TaxExclusiveAmount currencyID="JO">100.000</cbc:TaxExclusiveAmount>',
    );
    expect(mapped.xml).toContain('Issuer &amp; Sons');
    expect(mapped.xml).toContain('Buyer &lt;Test&gt;');
  });
  it('maps income only with explicitly reviewed INCOME category', () => {
    const i = fixture();
    i.invoiceTypeName = '021';
    i.lines[0]!.taxCategoryCode = 'INCOME';
    i.lines[0]!.taxRate = { toString: () => '0' } as never;
    i.taxTotal = { toString: () => '0' } as never;
    i.grandTotal = { toString: () => '90' } as never;
    const xml = mapper.map(i, '123').xml;
    expect(xml).not.toContain('<cac:TaxTotal>');
    expect(xml).toContain('name="021"');
  });
  it.each([
    'issuerCountryCodeSnapshot',
    'buyerCountryCodeSnapshot',
    'invoiceTypeName',
    'invoiceCounter',
  ] as const)('fails missing %s', (field) => {
    const i = fixture();
    Object.assign(i, { [field]: null });
    expect(() => mapper.map(i, '123')).toThrow('not ready');
  });
  it.each(['STANDARD', '', null])('does not invent tax category from %s', (category) => {
    const i = fixture();
    i.lines[0]!.taxCategoryCode = category;
    expect(() => mapper.map(i, '123')).toThrow('not ready');
  });
  it('export nonzero tax is blocked', () => {
    const i = fixture();
    i.invoiceTypeName = '122';
    expect(mapper.readiness(i).join()).toContain('Export');
  });
  it('extracts signed official amounts separately from the original snapshot', () => {
    const i = fixture();
    const encoded = Buffer.from(
      mapper
        .map(i, '123')
        .xml.replace(
          '<cbc:PayableAmount currencyID="JO">104.400',
          '<cbc:PayableAmount currencyID="JO">105.400',
        )
        .replace(
          '<cbc:TaxInclusiveAmount currencyID="JO">104.400',
          '<cbc:TaxInclusiveAmount currencyID="JO">105.400',
        )
        .replaceAll('14.400', '15.400'),
    ).toString('base64');
    expect(parseOfficialValues(encoded, i.internalReference, i.submissionUuid)?.grandTotal).toBe(
      '105.400',
    );
    expect(i.grandTotal.toString()).toBe('104.400');
  });
  it('rejects signed XML identity mismatch and DTD', () => {
    const i = fixture();
    const xml = mapper.map(i, '123').xml;
    expect(() =>
      parseOfficialValues(Buffer.from(xml).toString('base64'), 'wrong', i.submissionUuid),
    ).toThrow('IDENTITY_MISMATCH');
    expect(() =>
      parseOfficialValues(
        Buffer.from('<!DOCTYPE x><Invoice/>').toString('base64'),
        i.internalReference,
        i.submissionUuid,
      ),
    ).toThrow('MALFORMED');
  });
  it('renders exact official response payload as a graphical PNG', async () => {
    expect(await officialQrImage('exact-official-payload')).toMatch(/^data:image\/png;base64,/);
  });
});
