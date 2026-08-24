import { BadRequestException, Injectable } from '@nestjs/common';

export const RENEWAL_TEMPLATE_KEYS = [
  'customerCompany',
  'customerContact',
  'subscriptionName',
  'serviceType',
  'renewalDate',
  'serviceDescription',
  'renewalAmount',
  'currency',
  'billingEntity',
  'renewalCaseReference',
] as const;

export type RenewalTemplateValues = Record<(typeof RENEWAL_TEMPLATE_KEYS)[number], string>;

const PLACEHOLDER = /{{\s*([A-Za-z][A-Za-z0-9]*)\s*}}/g;
const allowed = new Set<string>(RENEWAL_TEMPLATE_KEYS);

@Injectable()
export class RenewalTemplateRenderer {
  validate(template: string): void {
    for (const match of template.matchAll(PLACEHOLDER)) {
      const key = match[1];
      if (!key || !allowed.has(key)) {
        throw new BadRequestException(
          `Unsupported renewal template placeholder: ${key ?? 'unknown'}.`,
        );
      }
    }
  }

  render(template: string, values: RenewalTemplateValues): string {
    this.validate(template);
    return template.replace(PLACEHOLDER, (_match, key: keyof RenewalTemplateValues) => values[key]);
  }
}
