import { extractPhoneNumbers } from './phone-normalizer';

describe('extractPhoneNumbers', () => {
  it('normalizes a Jordan local mobile number', () => {
    const phones = extractPhoneNumbers('0776222256');
    expect(phones).toEqual([
      expect.objectContaining({
        phoneNumber: '+962776222256',
        countryCallingCode: '+962',
        phoneType: 'MOBILE',
        country: 'Jordan',
      }),
    ]);
  });

  it('splits two full numbers separated by a dash into two independent records', () => {
    const phones = extractPhoneNumbers('0776222256 - 0745510473');
    expect(phones.map((phone) => phone.phoneNumber)).toEqual(['+962776222256', '+962745510473']);
  });

  it('inherits the shared country/area prefix for a short dash-joined suffix', () => {
    const phones = extractPhoneNumbers('+962 6 5863101 - 5865712');
    expect(phones.map((phone) => phone.phoneNumber)).toEqual(['+96265863101', '+96265865712']);
    expect(phones[1]).toEqual(
      expect.objectContaining({ areaOrOperatorCode: '6', subscriberNumber: '5865712' }),
    );
  });

  it('expands a shorthand slash-suffix into separate phone channels', () => {
    const phones = extractPhoneNumbers('+962 6 5868440/1/2');
    expect(phones.map((phone) => phone.phoneNumber)).toEqual([
      '+96265868440',
      '+96265868441',
      '+96265868442',
    ]);
  });

  it('keeps Saudi formatting hyphens as one mobile number rather than splitting them', () => {
    const phones = extractPhoneNumbers('0096650-055-9009');
    expect(phones).toHaveLength(1);
    expect(phones[0]).toEqual(
      expect.objectContaining({ phoneNumber: '+966500559009', country: 'Saudi Arabia' }),
    );
  });

  it('rejects an incomplete value with no subscriber number rather than importing it', () => {
    expect(extractPhoneNumbers('Fax: +9626')).toEqual([]);
    expect(extractPhoneNumbers('Fax: +')).toEqual([]);
  });

  it('tags a labeled fax line as FAX even when the digits look like a normal Jordan mobile', () => {
    const phones = extractPhoneNumbers('Fax: 0776222256');
    expect(phones).toEqual([expect.objectContaining({ phoneType: 'FAX' })]);
  });

  it('parses multiple labeled lines from one cell, dropping the incomplete fax line', () => {
    const phones = extractPhoneNumbers('Tel: + 9626 5539921\nFax: +');
    expect(phones).toEqual([
      expect.objectContaining({ phoneNumber: '+96265539921', phoneType: 'LANDLINE' }),
    ]);
  });

  describe('manually approved corrections', () => {
    it('replaces both malformed Sami Kashkol values with the one verified Iraqi mobile', () => {
      expect(extractPhoneNumbers('+06477114466666')).toEqual([
        expect.objectContaining({
          phoneNumber: '+9647702987851',
          country: 'Iraq',
          verificationStatus: 'VERIFIED',
          normalizationMethod: 'MANUAL_CONFIRMED_CORRECTION',
        }),
      ]);
      expect(extractPhoneNumbers('47901511318')).toEqual([
        expect.objectContaining({ phoneNumber: '+9647702987851' }),
      ]);
    });

    it('removes the malformed Jordan mobile completely instead of importing it', () => {
      expect(extractPhoneNumbers('079821889')).toEqual([]);
    });

    it("corrects Khalil Hdaib's legacy number", () => {
      expect(extractPhoneNumbers('077332511')).toEqual([
        expect.objectContaining({ phoneNumber: '+962797024222' }),
      ]);
    });

    it('corrects the doubled-6 Jordan landline typo', () => {
      expect(extractPhoneNumbers('+9626 65536165')).toEqual([
        expect.objectContaining({ phoneNumber: '+96265536165' }),
      ]);
    });

    it("corrects Dr. Eyad Shahrouri's legacy mobile", () => {
      expect(extractPhoneNumbers('07778448448')).toEqual([
        expect.objectContaining({ phoneNumber: '+962778448448' }),
      ]);
    });
  });
});
