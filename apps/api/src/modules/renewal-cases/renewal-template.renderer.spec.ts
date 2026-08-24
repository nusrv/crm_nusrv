import { RenewalTemplateRenderer, type RenewalTemplateValues } from './renewal-template.renderer';

const values: RenewalTemplateValues = {
  customerCompany: 'Example LLC',
  customerContact: 'Sam',
  subscriptionName: 'example.test Hosting',
  serviceType: 'Hosting',
  renewalDate: '2026-09-23',
  serviceDescription: 'Managed hosting',
  renewalAmount: '120.000',
  currency: 'JOD',
  billingEntity: 'New Serve',
  renewalCaseReference: 'case-id',
};

describe('RenewalTemplateRenderer', () => {
  const renderer = new RenewalTemplateRenderer();

  it('renders only the allowlisted operational renewal fields', () => {
    expect(renderer.render('{{customerCompany}} — {{subscriptionName}}', values)).toBe(
      'Example LLC — example.test Hosting',
    );
  });

  it('rejects general or unknown template placeholders', () => {
    expect(() => renderer.render('{{marketingCampaign}}', values)).toThrow(
      'Unsupported renewal template placeholder',
    );
  });
});
