import { packageCatalogSeeds } from './package-catalog.seed-data';

describe('official package catalog seed', () => {
  it('contains the 19 Packages.docx offers plus eight service-specific custom templates', () => {
    expect(packageCatalogSeeds.filter((item) => item.kind !== 'CUSTOM_TEMPLATE')).toHaveLength(19);
    expect(packageCatalogSeeds.filter((item) => item.kind === 'CUSTOM_TEMPLATE')).toHaveLength(8);
    expect(new Set(packageCatalogSeeds.map((item) => item.code)).size).toBe(
      packageCatalogSeeds.length,
    );
  });

  it('keeps catalog pricing and supported historical terms explicit', () => {
    const ssl = packageCatalogSeeds.find((item) => item.code === 'SSL_SINGLE');
    expect(ssl?.terms.map((term) => term.termMonths)).toEqual([12, 36, 60]);
    expect(packageCatalogSeeds.find((item) => item.code === 'HOSTING_PREMIUM')?.terms).toEqual([
      { termMonths: 12, currency: 'JOD', standardSellingPrice: '250.000' },
      { termMonths: 36, currency: 'JOD', standardSellingPrice: '525.000' },
    ]);
  });
});
