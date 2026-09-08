import { splitBilingualName } from './name-language.util';

describe('splitBilingualName', () => {
  it('classifies an Arabic-script name into nameAr, leaving nameEn empty', () => {
    const name = String.fromCodePoint(0x634, 0x631, 0x643, 0x629);
    expect(splitBilingualName(name)).toEqual({ nameAr: name });
  });

  it('classifies a Latin-script name into nameEn, leaving nameAr empty', () => {
    expect(splitBilingualName('Future Technology LLC')).toEqual({ nameEn: 'Future Technology LLC' });
  });

  it('treats a name containing any Arabic-script character as Arabic, even mixed with Latin', () => {
    const mixed = `Future ${String.fromCodePoint(0x634, 0x631, 0x643, 0x629)}`;
    expect(splitBilingualName(mixed)).toEqual({ nameAr: mixed });
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
