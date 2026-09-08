import { splitBilingualName } from './name-language.util';

// Arabic text built from explicit codepoints rather than literal glyphs, so the exact string
// under test is auditable here and never depends on the source file's own encoding fidelity.
const shobak = String.fromCodePoint(
  0x62e,
  0x64a,
  0x631,
  0x627,
  0x62a,
  0x20,
  0x627,
  0x644,
  0x634,
  0x648,
  0x628,
  0x643,
); // "خيرات الشوبك"
const nasrArabic = String.fromCodePoint(
  0x634,
  0x631,
  0x643,
  0x629,
  0x20,
  0x646,
  0x635,
  0x631,
  0x20,
  0x627,
  0x631,
  0x634,
  0x64a,
  0x62f,
  0x627,
  0x62a,
  0x20,
  0x648,
  0x627,
  0x648,
  0x644,
  0x627,
  0x62f,
  0x647,
); // "شركة نصر ارشيدات واولاده"

describe('splitBilingualName', () => {
  it('classifies an Arabic-only name into nameAr, leaving nameEn empty', () => {
    expect(splitBilingualName(shobak)).toEqual({ nameAr: shobak });
  });

  it('classifies an English-only name into nameEn, leaving nameAr empty', () => {
    expect(splitBilingualName('Future Technology LLC')).toEqual({
      nameEn: 'Future Technology LLC',
    });
  });

  it('splits a Latin-then-Arabic mixed name into both fields without translation or loss', () => {
    const mixed = `Khayrat Al Shobak ${shobak}`;
    expect(splitBilingualName(mixed)).toEqual({ nameEn: 'Khayrat Al Shobak', nameAr: shobak });
  });

  it('splits a Latin-then-Arabic mixed name that includes an ampersand in the English part', () => {
    const mixed = `Nasr Irshaidat & sons company ${nasrArabic}`;
    expect(splitBilingualName(mixed)).toEqual({
      nameEn: 'Nasr Irshaidat & sons company',
      nameAr: nasrArabic,
    });
  });

  it('splits an Arabic-then-Latin mixed name (reverse order) into both fields', () => {
    const mixed = `${shobak} Khayrat Al Shobak`;
    expect(splitBilingualName(mixed)).toEqual({ nameEn: 'Khayrat Al Shobak', nameAr: shobak });
  });

  it('trims a dash separator left between the two split spans', () => {
    const mixed = `Khayrat Al Shobak - ${shobak}`;
    expect(splitBilingualName(mixed)).toEqual({ nameEn: 'Khayrat Al Shobak', nameAr: shobak });
  });

  it('falls back to preserving the whole value unsplit when Arabic and Latin are interleaved', () => {
    // A Latin word sits between two Arabic words, so there is no single clean Arabic block —
    // splitting would either drop "Group" or misclassify it. Preserve the original text instead.
    const interleaved = `${shobak} Group ${nasrArabic}`;
    expect(splitBilingualName(interleaved)).toEqual({ nameAr: interleaved });
  });

  it('falls back to preserving the whole value unsplit for a Latin-Arabic-Latin sandwich', () => {
    const sandwich = `Future ${shobak} Technology`;
    expect(splitBilingualName(sandwich)).toEqual({ nameAr: sandwich });
  });

  it('preserves the original text unchanged rather than trimming internal content', () => {
    const name = '  Future   Technology LLC  ';
    expect(splitBilingualName(name)).toEqual({ nameEn: 'Future   Technology LLC' });
  });

  it('returns an empty object for undefined, null, or blank input', () => {
    expect(splitBilingualName(undefined)).toEqual({});
    expect(splitBilingualName(null)).toEqual({});
    expect(splitBilingualName('   ')).toEqual({});
  });
});
