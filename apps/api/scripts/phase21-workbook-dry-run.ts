import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as XLSX from '@e965/xlsx';
import { parseLegacyWorkbook } from '../src/modules/legacy-import/legacy-workbook.parser';

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const workbookPath = option('--workbook');
if (!workbookPath) {
  throw new Error(
    'Usage: tsx scripts/phase21-workbook-dry-run.ts --workbook <path> [--output <path>]',
  );
}
const resolvedWorkbook = resolve(workbookPath);
const activeRows = parseLegacyWorkbook(
  readFileSync(resolvedWorkbook),
  resolvedWorkbook.split(/[\\/]/).at(-1) ?? 'legacy.xlsx',
).filter((row) => row.sheetName === 'Active_Subscriptions');

const report = {
  generatedAt: new Date().toISOString(),
  sourceFileName: resolvedWorkbook.split(/[\\/]/).at(-1),
  sourceWorkbookModified: false,
  sheet: 'Active_Subscriptions',
  totalActiveRows: activeRows.length,
  classifications: Object.fromEntries(
    ['MATCHED_OFFICIAL', 'CUSTOM', 'MANUAL_REVIEW'].map((status) => [
      status,
      activeRows.filter((row) => row.suggestions.classificationStatus === status).length,
    ]),
  ),
  readyForLiveApproval: 0,
  manualApprovalRequired: activeRows.length,
  rows: activeRows.map((row) => ({
    sourceRowNumber: row.sourceRowNumber,
    companyName: row.suggestions.companyName,
    sourceRegistration: row.suggestions.sourceRegistration,
    sourcePackageName: row.suggestions.sourcePackageName,
    suggestedServiceType: row.suggestions.serviceTypeName,
    suggestedPackageCode: row.suggestions.servicePackageCode,
    classificationStatus: row.suggestions.classificationStatus,
    technicalInformation: row.suggestions.classificationEvidence.information,
    sourceStartDate: row.suggestions.sourceStartDate,
    sourceEndDate: row.suggestions.sourceEndDate,
    sourceRenewalReminderDate: row.suggestions.sourceRenewalReminderDate,
    suggestedStartDate: row.suggestions.startDate,
    suggestedRenewalDate: row.suggestions.renewalDate,
    suggestedSellingPrice: row.suggestions.sellingPrice,
    suggestedCurrency: row.suggestions.currency,
    suggestedRenewalIntervalMonths: row.suggestions.renewalIntervalMonths,
    matchedRules: row.suggestions.classificationEvidence.matchedRules,
    conflicts: row.suggestions.classificationEvidence.conflicts,
    issues: row.suggestions.issues,
  })),
};

if (report.totalActiveRows !== 214) {
  throw new Error(
    `Expected 214 Active_Subscriptions records; parser found ${report.totalActiveRows}. No migration was performed.`,
  );
}

const outputPath = option('--output');
if (outputPath) writeFileSync(resolve(outputPath), JSON.stringify(report, null, 2));
const reviewWorkbookPath = option('--review-workbook');
if (reviewWorkbookPath) {
  const reviewRows = report.rows.map((row) => ({
    'Source Row': row.sourceRowNumber,
    Company: row.companyName,
    'Source Registration': row.sourceRegistration,
    'Source Package': row.sourcePackageName,
    'Technical Information (redacted)': row.technicalInformation,
    'Suggested Service Type': row.suggestedServiceType,
    'Suggested Package Code': row.suggestedPackageCode,
    Classification: row.classificationStatus,
    Conflicts: row.conflicts.join(' | '),
    'Source Reminder Date (not confirmed renewal)': row.sourceRenewalReminderDate,
    'Suggested Actual Price': row.suggestedSellingPrice,
    'Suggested Currency': row.suggestedCurrency,
    'Suggested Interval Months': row.suggestedRenewalIntervalMonths,
    'Owner Decision (APPROVE/CORRECT/SPLIT)': '',
    'Confirmed Package Code': '',
    'Prefilled Start Date (confirm)': row.suggestedStartDate,
    'Prefilled Renewal Date (confirm)': row.suggestedRenewalDate,
    'Confirmed Selling Price': '',
    'Confirmed Currency': '',
    'Confirmed Renewal Interval Months': '',
    'Number of Subscriptions After Explicit Split': 1,
    'Human Resolution Notes': '',
  }));
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(reviewRows);
  sheet['!cols'] = Object.keys(reviewRows[0] ?? {}).map((key) => ({
    wch: Math.min(Math.max(key.length + 2, 16), 55),
  }));
  XLSX.utils.book_append_sheet(workbook, sheet, 'Active_Subscriptions_Review');
  XLSX.writeFile(workbook, resolve(reviewWorkbookPath));
}
console.log(JSON.stringify({ ...report, rows: undefined }, null, 2));
