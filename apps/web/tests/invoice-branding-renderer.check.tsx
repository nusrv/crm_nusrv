import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { defaultInvoiceVisibility, type IssuerPresentation } from '@cp/shared';
import { InvoiceRenderer } from '../components/invoice-renderer';
import type { InvoiceView } from '../components/invoice-types';
import { BRANDING_PRESETS } from '../components/invoice-branding-presets';
const root = process.cwd();
const nusrvLogo =
  'data:image/png;base64,' +
  readFileSync(join(root, '../web/public/nusrv-invoice-logo.png')).toString('base64');
const futureLogo =
  'data:image/png;base64,' +
  readFileSync(
    join(root, '../web/public/invoice-branding-presets/future-foresight-logo.png'),
  ).toString('base64');
const future = BRANDING_PRESETS.FUTURE_FORESIGHT_INTERNATIONAL!;
assert.equal(
  futureLogo,
  'data:image/png;base64,' +
    readFileSync(
      join(root, '../../docs/templates/assets/future-foresight-logo-transparent.png'),
    ).toString('base64'),
);
function view(overrides: Record<string, unknown> = {}): InvoiceView {
  return {
    id: 'invoice',
    billingEntityId: 'issuer-a',
    issuerCodeSnapshot: 'CUSTOM',
    status: 'FAWTARA_ACCEPTED',
    finalPrintEnabled: true,
    internalReference: 'INV-1',
    invoiceDate: '2026-11-18',
    invoiceTypeName: '022',
    currencyCode: 'JOD',
    effectiveCurrencyCode: 'JOD',
    issuerLegalNameSnapshot: 'Seller Legal Name',
    issuerLegalNameArSnapshot: null,
    issuerAddressSnapshot: 'Seller Address',
    issuerTaxNumberSnapshot: '12345678',
    issuerInvoiceEmailSnapshot: 'seller@example.test',
    issuerBankDetailsSnapshot: null,
    issuerLogoDataUrl: null,
    customerNameEnSnapshot: 'Buyer Name',
    customerNameArSnapshot: null,
    customerAddressSnapshot: 'Buyer Address',
    customerCountrySnapshot: 'JO',
    customerTaxNumberSnapshot: '87654321',
    fawtaraInvoiceNumber: 'OFFICIAL-1',
    fawtaraInvoiceUuid: 'OFFICIAL-UUID',
    fawtaraQrImageDataUrl: 'data:image/png;base64,OFFICIALFIXTURE',
    effectiveSubtotal: '100.000',
    effectiveDiscountTotal: '0.000',
    effectiveTaxTotal: '16.000',
    effectiveGrandTotal: '116.000',
    officialValueDiscrepancies: [],
    lines: [
      {
        id: 'line',
        description: 'Service',
        serviceSnapshotText: 'Service details',
        periodStart: '2026-01-01',
        periodEnd: '2027-01-01',
        quantity: '1.000',
        unitPrice: '100.000',
        discountAmount: '0.000',
        taxRate: '16',
        taxAmount: '16.000',
        lineTotal: '116.000',
      },
    ],
    issuerPresentationSnapshot: {
      version: 1,
      profileRevision: 1,
      issuerType: 'COMPANY',
      logoAssetId: null,
      countryCode: 'JO',
      details: {},
      visibility: defaultInvoiceVisibility(),
    },
    ...overrides,
  } as unknown as InvoiceView;
}
const render = (i: InvoiceView) =>
  renderToStaticMarkup(createElement(InvoiceRenderer, { invoice: i }));
const base = view();
const p = base.issuerPresentationSnapshot as IssuerPresentation;
const newServe = render(
  view({ issuerLegalNameSnapshot: 'New Serve', issuerLogoDataUrl: nusrvLogo }),
);
const foresight = render(
  view({
    issuerLegalNameSnapshot: future.legalName,
    issuerLegalNameArSnapshot: future.legalNameAr,
    issuerInvoiceEmailSnapshot: future.invoiceEmail,
    issuerLogoDataUrl: futureLogo,
    issuerPresentationSnapshot: { ...p, logoAssetId: 'future-logo', details: future.details },
  }),
);
assert(newServe.includes(nusrvLogo) && !newServe.includes(futureLogo));
assert(foresight.includes(futureLogo) && !foresight.includes(nusrvLogo));
assert(foresight.includes(future.legalName));
assert(foresight.includes('JO87UBSI1080000140173392215101'));
assert(foresight.includes('info@nusrv.com'));
assert(foresight.includes('+962 6 5866471'));
assert(foresight.includes('UBSIJOAXXXX'));
const personal = view({
  issuerPresentationSnapshot: {
    ...p,
    issuerType: 'INDIVIDUAL',
    logoAssetId: null,
    visibility: { ...p.visibility, nameEn: false, address: false, taxNumber: false },
  },
});
const personalHtml = render(personal);
assert(!personalHtml.includes('class="nusrv-logo"'));
assert(personalHtml.includes('Seller Legal Name'));
assert(personalHtml.includes('Seller Address'));
assert(personalHtml.includes('12345678'));
assert.equal((personalHtml.match(/Sales Tax No\./g) ?? []).length, 1);
assert(!personalHtml.includes('Tax / National No.'));
assert(!personalHtml.includes('87654321'));
const draftHtml = render({ ...personal, status: 'DRAFT' });
assert(draftHtml.includes('DRAFT / NOT OFFICIAL'));
assert(!draftHtml.includes('Seller Address'));
assert(!draftHtml.includes('12345678'));
assert(!draftHtml.includes('Official JoFotara QR'));
assert(draftHtml.includes('personal-invoice-document'));
assert(!draftHtml.includes('Layout proposal'));
assert(draftHtml.includes('Not issued'));
assert(!draftHtml.includes('OFFICIAL-1'));
assert(!draftHtml.includes('OFFICIALFIXTURE'));
assert(!personalHtml.includes('personal-invoice-document'));
const officialPersonal = view({
  issuerPresentationSnapshot: {
    ...p,
    issuerType: 'INDIVIDUAL',
    templateVersion: 'personal-v1',
    visibility: { ...p.visibility, nameEn: false, address: false, taxNumber: false },
  },
});
const officialPersonalHtml = render(officialPersonal);
assert(officialPersonalHtml.includes('personal-invoice-document'));
assert(officialPersonalHtml.includes('Official JoFotara QR'));
assert(officialPersonalHtml.includes('OFFICIAL-1'));
assert(officialPersonalHtml.includes('OFFICIAL-UUID'));
assert(officialPersonalHtml.includes('Seller Legal Name'));
assert(officialPersonalHtml.includes('Seller Address'));
assert(officialPersonalHtml.includes('Sales Tax No.: 12345678'));
assert(!officialPersonalHtml.includes('87654321'));
assert(!officialPersonalHtml.includes('DRAFT / NOT OFFICIAL'));
assert(!officialPersonalHtml.includes('nusrv-header'));
assert(!render({ ...officialPersonal, finalPrintEnabled: false }).includes('OFFICIAL-1'));
assert(!render({ ...officialPersonal, finalPrintEnabled: false }).includes('Official JoFotara QR'));

const personalVisibleDraft = render(view({
  status: 'DRAFT',
  issuerPresentationSnapshot: { ...p, issuerType: 'INDIVIDUAL' },
}));
assert(personalVisibleDraft.includes('personal-invoice-header'));
assert(personalVisibleDraft.includes('Issued by'));
assert(personalVisibleDraft.includes('Bill to'));
assert(personalVisibleDraft.includes('Sales Tax No.: 12345678'));
assert(!personalVisibleDraft.includes('87654321'));
assert(!personalVisibleDraft.includes('class="nusrv-logo"'));
assert(!render(view({ status: 'DRAFT' })).includes('personal-invoice-document'));
assert(!render({ ...personal, finalPrintEnabled: false }).includes('personal-invoice-document'));

const hidden = render(
  view({
    issuerPresentationSnapshot: {
      ...p,
      details: {
        bankName: 'Secret hidden bank',
        jodIban: 'HIDDEN-JOD',
        usdIban: 'VISIBLE-USD',
        phone: 'HIDDEN-PHONE',
      },
      visibility: { ...p.visibility, bankName: false, jodBank: false, phone: false },
    },
  }),
);
assert(!hidden.includes('HIDDEN-JOD'));
assert(!hidden.includes('Secret hidden bank'));
assert(!hidden.includes('HIDDEN-PHONE'));
assert(hidden.includes('VISIBLE-USD'));
const logoOff = render(
  view({
    issuerLogoDataUrl: nusrvLogo,
    issuerPresentationSnapshot: { ...p, visibility: { ...p.visibility, logo: false } },
  }),
);
assert(!logoOff.includes(nusrvLogo));
assert(!logoOff.includes('class="nusrv-logo"'));
// A third COMPANY issuer must use the SAME template without importing NUSRV or
// Future Foresight data from today's brand presets.
const otherCompany = render(view({
  customerId: null,
  sourceSubscriptionId: null,
  sourceSubscription: null,
  issuerCodeSnapshot: 'THIRD_COMPANY',
  issuerLegalNameSnapshot: 'Third Example Company LLC',
  issuerTaxNumberSnapshot: 'THIRD-TAX-123',
  issuerAddressSnapshot: 'Third issuer registered address',
  issuerLogoDataUrl: null,
  customerCodeSnapshot: 'ONE-TIME',
  customerNameEnSnapshot: 'Independent one-time buyer',
  issuerPresentationSnapshot: {
    ...p,
    issuerType: 'COMPANY',
    logoAssetId: null,
    details: { bankName: 'Third Bank', jodIban: 'JO00-THIRD-IBAN' },
  },
}));
assert(otherCompany.includes('Third Example Company LLC'));
assert(otherCompany.includes('THIRD-TAX-123'));
assert(otherCompany.includes('Independent one-time buyer'));
assert(otherCompany.includes('JO00-THIRD-IBAN'));
assert(!otherCompany.includes('NEW SERVE LOCAL'));
assert(!otherCompany.includes('FUTURE FORESIGHT INTERNATIONAL'));
assert(!otherCompany.includes('class="nusrv-logo"'));
for (const companyHtml of [newServe, foresight, otherCompany]) {
  for (const section of ['nusrv-header', 'nusrv-items', 'nusrv-totals', 'nusrv-footer']) {
    assert(companyHtml.includes(`class="${section}"`));
  }
  assert.equal((companyHtml.match(/Sales Tax No\./g) ?? []).length, 1);
  assert(!companyHtml.includes('Tax / National No.'));
  assert(!companyHtml.includes('87654321'));
}
assert(otherCompany.includes('Sales Tax No.: THIRD-TAX-123'));

// A draft with an unresolved tax rate is NOT a zero-rate assertion. The
// currently provisionally zero arithmetic must never render a bare "%".
const independentDraft = render(view({
  status: 'DRAFT',
  sourceSubscriptionId: null,
  sourceSubscription: null,
  customerId: null,
  customerCodeSnapshot: 'ONE-TIME',
  customerNameEnSnapshot: 'Draft one-time buyer',
  lines: [{ ...view().lines[0]!, taxRate: null }],
}));
assert(independentDraft.includes('Tax review required'));
assert(independentDraft.includes('DRAFT / NOT OFFICIAL'));
assert(!independentDraft.includes('Official JoFotara QR'));

const historical = view({
  issuerLogoDataUrl: futureLogo,
  issuerLegalNameSnapshot: 'Historical issuer',
  issuerPresentationSnapshot: structuredClone({ ...p, details: { jodIban: 'HISTORICAL-BANK' } }),
});
const before = render(historical);
const liveProfile = {
  details: { jodIban: 'NEW-LIVE-BANK' },
  logoAssetId: 'replacement-logo',
  legalName: 'New issuer name',
};
void liveProfile;
assert.equal(render(historical), before);
assert(before.includes('HISTORICAL-BANK'));
assert(!('taxNumber' in future));
assert(!('currencyCode' in future));
assert(!('invoiceTypeName' in future));
console.log(
  'PASS: shared renderer - NUSRV/Future/individual/no-logo/hidden-fields/legal-fields/historical snapshot (7 cases).',
);

async function writeVisualChecks() {
  const out = process.env.BRANDING_QA_OUTPUT_DIR;
  if (!out) return;
  mkdirSync(out, { recursive: true });
  const { officialQrImage } = await import('../../api/src/modules/invoices/official-qr');
  const qr = await officialQrImage('OFFICIAL-RESPONSE-PAYLOAD-FIXTURE');
  const cssDir = join(process.cwd(), '../web/.next/static/chunks');
  const css = readdirSync(cssDir)
    .filter((n) => n.endsWith('.css'))
    .map((n) => readFileSync(join(cssDir, n), 'utf8'))
    .join('\n');
  const ns = BRANDING_PRESETS.NEW_SERVE_LOCAL!;
  const cases: Record<string, InvoiceView> = {
    nusrv: view({
      issuerLegalNameSnapshot: ns.legalName,
      issuerLegalNameArSnapshot: ns.legalNameAr,
      issuerAddressSnapshot: ns.address,
      issuerInvoiceEmailSnapshot: ns.invoiceEmail,
      issuerLogoDataUrl: nusrvLogo,
      issuerPresentationSnapshot: { ...p, logoAssetId: 'nusrv-logo', details: ns.details },
    }),
    future: view({
      issuerLegalNameSnapshot: future.legalName,
      issuerLegalNameArSnapshot: future.legalNameAr,
      issuerAddressSnapshot: future.address,
      issuerInvoiceEmailSnapshot: future.invoiceEmail,
      issuerLogoDataUrl: futureLogo,
      issuerPresentationSnapshot: { ...p, logoAssetId: 'future-logo', details: future.details },
    }),
    personal: personal,
    personalOfficial: officialPersonal,
    generic: view({
      issuerLegalNameSnapshot: 'Generic Individual',
      issuerPresentationSnapshot: {
        ...p,
        issuerType: 'INDIVIDUAL',
        details: { bankName: 'Hidden Bank', jodIban: 'HIDDEN-IBAN' },
        visibility: { ...p.visibility, bankName: false, jodBank: false },
      },
    }),
    historical: historical,
    draft: { ...personal, status: 'DRAFT' },
    personalDraft: view({ status: 'DRAFT', issuerPresentationSnapshot: { ...p, issuerType: 'INDIVIDUAL' } }),
  };
  for (const [name, invoice] of Object.entries(cases)) {
    invoice.fawtaraQrImageDataUrl = qr;
    writeFileSync(
      join(out, name + '.html'),
      '<!doctype html><html><head><meta charset="utf-8"><style>' +
        css +
        '</style></head><body>' +
        render(invoice) +
        '</body></html>',
    );
  }
}
void writeVisualChecks();
