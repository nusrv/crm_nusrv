import { classifyLegacyValues } from './legacy-workbook.parser';

describe('Phase 2.1 deterministic legacy classification', () => {
  it('matches an official package only when package and technical evidence agree', () => {
    const result = classifyLegacyValues({
      'B — Company Name': 'Example',
      'C — E-mail Address': 'staff@example.test',
      'H — Registration Type': 'Hosting',
      'I — Package': 'PREMIUM PLAN',
      'J — Renwal frequancy': '1 Year',
      'K — Price JD': 250,
      'P — Information': 'Web Space 30GB; Mail Space 8GB; Monthly Transfer 250GB',
    });
    expect(result).toMatchObject({
      serviceTypeName: 'Hosting',
      servicePackageCode: 'HOSTING_PREMIUM',
      classificationStatus: 'MATCHED_OFFICIAL',
      renewalIntervalMonths: 12,
    });
  });

  it('does not trust a wrong registration type over SSL technical evidence', () => {
    const result = classifyLegacyValues({
      'B — Company Name': 'Example',
      'C — E-mail Address': 'staff@example.test',
      'H — Registration Type': 'Hosting',
      'I — Package': 'SSL Certificate',
      'P — Information': 'Single domain SSL certificate',
    });
    expect(result.classificationStatus).toBe('MANUAL_REVIEW');
    expect(result.serviceTypeName).toBe('SSL');
    expect(result.classificationEvidence.conflicts.join(' ')).toMatch(
      /Registration says Hosting.*SSL/i,
    );
  });

  it('requires human review for technical specification mismatch and bundled services', () => {
    const mismatch = classifyLegacyValues({
      'H — Registration Type': 'Hosting',
      'I — Package': 'PREMIUM PLAN',
      'P — Information': 'Web Space 50GB; Mail Space 20GB',
    });
    expect(mismatch.classificationStatus).toBe('MANUAL_REVIEW');
    expect(mismatch.classificationEvidence.conflicts.join(' ')).toMatch(/30GB|8GB/);

    const bundle = classifyLegacyValues({
      'H — Registration Type': 'Dedicated Server',
      'I — Package': '4X Power - LINUX',
      'P — Information': 'Linux 4GB RAM 2 Core CPU plus web hosting and SSL certificate',
    });
    expect(bundle.classificationStatus).toBe('MANUAL_REVIEW');
    expect(bundle.classificationEvidence.detectedServiceTypes.length).toBeGreaterThan(1);
  });

  it('preserves reminder-date evidence but never invents normalized renewal/start dates', () => {
    const result = classifyLegacyValues({
      'A — Renewal / date (-15days)': new Date('2026-09-01T00:00:00Z'),
      'H — Registration Type': 'Domain',
      'I — Package': 'Custom domain',
    });
    expect(result.sourceRenewalReminderDate).toBe('2026-09-01');
    expect(result).not.toHaveProperty('renewalDate');
    expect(result.issues.join(' ')).toMatch(/actual renewal date requires human confirmation/i);
  });
});
