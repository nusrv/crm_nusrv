import type { InvoiceDetails } from '@cp/shared';
export interface BrandingPreset {
  legalName: string;
  legalNameAr: string;
  address: string;
  countryCode: string;
  invoiceEmail: string;
  details: InvoiceDetails;
  logoUrl: string;
}
// Explicit ADMIN preview/apply only. Never infer an issuer tax number, invoice type or currency.
export const BRANDING_PRESETS: Record<string, BrandingPreset> = {
  NEW_SERVE_LOCAL: {
    legalName: 'New Serve for Digital Data Transformation',
    legalNameAr:
      '\u0634\u0631\u0643\u0629 \u0627\u0644\u062e\u062f\u0645\u0627\u062a \u0627\u0644\u0631\u0642\u0645\u064a\u0629 \u0627\u0644\u062d\u062f\u064a\u062b\u0629 \u0644\u0623\u062a\u0645\u062a\u0629 \u0627\u0644\u0628\u064a\u0627\u0646\u0627\u062a',
    address: 'No.3 Mamdouh Al Sarayra Street Amman',
    countryCode: 'JO',
    invoiceEmail: 'info@nusrv.com',
    details: {
      countryName: 'Jordan',
      phone: '+962 6 5866471',
      fax: '+962 6 5866473',
      website: 'http://www.nusrv.com',
      bankName: 'Bank al Etihad',
      bankBranch: 'Mecca Street',
      swift: 'UBSIJOAXXXX',
      jodAccount: '0140130154415101',
      jodIban: 'JO41UBSI1080000140130154415101',
      usdAccount: '0140230154415101',
      usdIban: 'JO03UBSI1080000140230154415101',
      eurAccount: '0142330154415101',
      eurIban: 'JO78UBSI1080000142330154415101',
    },
    logoUrl: '/nusrv-invoice-logo.png',
  },
  FUTURE_FORESIGHT_INTERNATIONAL: {
    legalName: 'FUTURE FOR SIGHT FOR TECHNOLOGY SERVICES',
    legalNameAr:
      '\u0634\u0631\u0643\u0629 \u0627\u0633\u062a\u0634\u0631\u0627\u0641 \u0627\u0644\u0645\u0633\u062a\u0642\u0628\u0644 \u0644\u062e\u062f\u0645\u0627\u062a \u0627\u0644\u062a\u0643\u0646\u0648\u0644\u0648\u062c\u064a\u0627\u062a',
    address: 'No.3 Mamdouh Al Sarayra Street Amman Jordan',
    countryCode: 'JO',
    invoiceEmail: 'info@nusrv.com',
    details: {
      countryName: 'Jordan',
      phone: '+962 6 5866471',
      fax: '+962 6 5866473',
      website: 'http://www.nusrv.com',
      bankName: 'Bank al Etihad',
      bankBranch: 'Mecca Street',
      swift: 'UBSIJOAXXXX',
      jodIban: 'JO87UBSI1080000140173392215101',
      usdIban: 'JO49UBSI1080000140273392215101',
      eurIban: 'JO27UBSI1080000142373392215101',
    },
    logoUrl: '/invoice-branding-presets/future-foresight-logo.png',
  },
};
