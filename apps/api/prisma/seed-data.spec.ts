import { ROLE_CODES } from '@cp/shared';
import {
  billingEntitySeeds,
  notificationRuleSeeds,
  reminderRuleSeeds,
  renewalTemplateSeeds,
  roleSeeds,
  serviceTypeSeeds,
} from './seed-data';

describe('Phase 0 seed data', () => {
  it('defines exactly the required initial reference records', () => {
    expect(billingEntitySeeds).toHaveLength(2);
    expect(billingEntitySeeds.map(({ paymentScope }) => paymentScope).sort()).toEqual([
      'INTERNATIONAL',
      'LOCAL',
    ]);
    expect(serviceTypeSeeds.map(({ code }) => code)).toEqual([
      'DOMAIN',
      'SSL',
      'HOSTING',
      'DEDICATED_SERVER',
      'SUPPORT',
      'ANTIVIRUS',
      'DNS_HOSTING',
      'APP_SUBSCRIPTION',
    ]);
    expect(roleSeeds.map(({ code }) => code)).toEqual(ROLE_CODES);
    expect(reminderRuleSeeds.map(({ daysBeforeDue }) => daysBeforeDue)).toEqual([
      30, 21, 14, 7, 2, 0,
    ]);
    expect(renewalTemplateSeeds).toHaveLength(6);
    expect(notificationRuleSeeds.map(({ daysBeforeDue }) => daysBeforeDue)).toEqual([2, 0]);
    expect(notificationRuleSeeds[0].recipientRoles).toEqual(['IT']);
    expect(notificationRuleSeeds[1].recipientRoles).toEqual(['IT', 'MANAGEMENT']);
    expect(renewalTemplateSeeds.at(-1)?.bodyTemplate).toContain('suspension after 24 hours');
  });
});
