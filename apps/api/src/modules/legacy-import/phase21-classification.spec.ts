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

  it('keeps the reminder as evidence without mistaking a new Start Date column for it', () => {
    const result = classifyLegacyValues({
      'A - Start Date': new Date('2026-01-16T00:00:00Z'),
      'B - End Date': new Date('2027-01-15T00:00:00Z'),
      'C - Renewal / date (-15days)': new Date('2026-12-31T00:00:00Z'),
      'D - Renwal Frequancy': '1 Year',
      'H - Registration Type': 'Domain',
      'I - Package': 'Custom domain',
    });
    expect(result).toMatchObject({
      sourceStartDate: '2026-01-16',
      sourceEndDate: '2027-01-15',
      sourceRenewalReminderDate: '2026-12-31',
      startDate: '2026-01-16',
      renewalDate: '2027-01-15',
    });
    expect(result.issues.join(' ')).not.toMatch(/Start Date column|End Date column|do not match/i);
  });

  it('prefills but flags explicit dates that conflict with the recorded term', () => {
    const result = classifyLegacyValues({
      'A - Start Date': new Date('2026-02-01T00:00:00Z'),
      'B - End Date': new Date('2027-01-15T00:00:00Z'),
      'C - Renewal / date (-15days)': new Date('2026-12-31T00:00:00Z'),
      'D - Renwal Frequancy': '1 Year',
      'H - Registration Type': 'Domain',
      'I - Package': 'Custom domain',
    });
    expect(result.startDate).toBe('2026-02-01');
    expect(result.renewalDate).toBe('2027-01-15');
    expect(result.issues.join(' ')).toMatch(/do not match the recorded renewal interval/i);
  });
});
