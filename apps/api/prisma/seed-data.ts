import type { RoleCode } from '@cp/shared';

export const billingEntitySeeds = [
  {
    code: 'NEW_SERVE_LOCAL',
    name: 'New Serve for Digital Data Transformation',
    legalName: 'New Serve for Digital Data Transformation',
    paymentScope: 'LOCAL' as const,
  },
  {
    code: 'FUTURE_FORESIGHT_INTERNATIONAL',
    name: 'Future foresight for Digital Data Transformation',
    legalName: 'Future foresight for Digital Data Transformation',
    paymentScope: 'INTERNATIONAL' as const,
  },
] as const;

export const serviceTypeSeeds = [
  { code: 'DOMAIN', name: 'Domain' },
  { code: 'SSL', name: 'SSL' },
  { code: 'HOSTING', name: 'Hosting' },
  { code: 'DEDICATED_SERVER', name: 'Dedicated Server' },
  { code: 'SUPPORT', name: 'Support' },
  { code: 'ANTIVIRUS', name: 'Antivirus' },
] as const;

export const roleSeeds: ReadonlyArray<{
  code: RoleCode;
  name: string;
  description: string;
}> = [
  { code: 'ADMIN', name: 'Admin', description: 'Platform administration and audited override.' },
  {
    code: 'ACCOUNTANT',
    name: 'Accountant',
    description: 'Invoice publication and payment confirmation.',
  },
  { code: 'IT', name: 'IT', description: 'Technical approvals and service actions.' },
  {
    code: 'SALES_DEVELOPMENT',
    name: 'Sales Development',
    description: 'Retention and commercial follow-up.',
  },
  {
    code: 'MANAGEMENT',
    name: 'Management',
    description: 'Dashboards and configured intervention.',
  },
];

const customerTemplate = (daysBeforeDue: number, label: string) => ({
  code: `RENEWAL_${label}`,
  name: `Renewal reminder ${label}`,
  subjectTemplate: `Renewal ${label}: {{subscriptionName}} — {{renewalDate}}`,
  bodyTemplate:
    daysBeforeDue === 0
      ? 'Final warning for {{customerCompany}}: {{subscriptionName}} expires on {{renewalDate}}. The service becomes subject to suspension after 24 hours. Amount: {{renewalAmount}} {{currency}}. Billing entity: {{billingEntity}}. Renewal case: {{renewalCaseReference}}.'
      : 'Hello {{customerContact}}, {{subscriptionName}} ({{serviceType}}) renews on {{renewalDate}}. Service: {{serviceDescription}}. Amount: {{renewalAmount}} {{currency}}. Billing entity: {{billingEntity}}. Renewal case: {{renewalCaseReference}}.',
  daysBeforeDue,
});

export const renewalTemplateSeeds = [
  customerTemplate(30, 'D30'),
  customerTemplate(21, 'D21'),
  customerTemplate(14, 'D14'),
  customerTemplate(7, 'D7'),
  customerTemplate(2, 'D2'),
  customerTemplate(0, 'D0'),
] as const;

export const reminderRuleSeeds = renewalTemplateSeeds.map((template) => ({
  code: `CUSTOMER_${template.code.replace('RENEWAL_', '')}`,
  name: template.name,
  daysBeforeDue: template.daysBeforeDue,
  templateCode: template.code,
}));

export const notificationRuleSeeds = [
  {
    code: 'INTERNAL_D2',
    name: 'D-2 IT escalation',
    daysBeforeDue: 2,
    recipientRoles: ['IT'],
    recipientEmails: [],
    subjectTemplate: 'Urgent renewal D-2: {{subscriptionName}}',
    bodyTemplate:
      '{{customerCompany}} / {{subscriptionName}} renews on {{renewalDate}}. Renewal case: {{renewalCaseReference}}.',
  },
  {
    code: 'INTERNAL_D0',
    name: 'Expiry-day IT and management escalation',
    daysBeforeDue: 0,
    recipientRoles: ['IT', 'MANAGEMENT'],
    recipientEmails: [],
    subjectTemplate: 'Expiry today: {{subscriptionName}}',
    bodyTemplate:
      '{{customerCompany}} / {{subscriptionName}} expires today. Customer received the final 24-hour suspension warning. Renewal case: {{renewalCaseReference}}.',
  },
] as const;
