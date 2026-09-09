import 'reflect-metadata';
import { validate } from 'class-validator';
import { BillingFrequency, SubscriptionStatus } from '../../generated/prisma/enums';
import { CreateSubscriptionDto, UpdateSubscriptionDto } from './subscriptions.dto';

function validSubscription(overrides: Record<string, unknown> = {}) {
  return Object.assign(new CreateSubscriptionDto(), {
    customerId: '10000000-0000-4000-8000-000000000001',
    serviceTypeId: '20000000-0000-4000-8000-000000000001',
    name: 'Hosting',
    startDate: '2026-09-09',
    billingFrequency: BillingFrequency.ANNUAL,
    renewalIntervalMonths: 12,
    sellingPrice: '100.000',
    currency: 'JOD',
    status: SubscriptionStatus.ACTIVE,
    ...overrides,
  });
}

describe('CreateSubscriptionDto', () => {
  it('accepts a valid payload with no renewalDate field at all — the server derives it', async () => {
    const input = validSubscription();
    expect('renewalDate' in input).toBe(false);
    expect(await validate(input)).toEqual([]);
  });

  it('rejects renewalIntervalMonths = 0', async () => {
    const input = validSubscription({ renewalIntervalMonths: 0 });
    expect(await validate(input)).toEqual(
      expect.arrayContaining([expect.objectContaining({ property: 'renewalIntervalMonths' })]),
    );
  });

  it('rejects a negative renewalIntervalMonths', async () => {
    const input = validSubscription({ renewalIntervalMonths: -6 });
    expect(await validate(input)).toEqual(
      expect.arrayContaining([expect.objectContaining({ property: 'renewalIntervalMonths' })]),
    );
  });

  it('rejects a missing renewalIntervalMonths — it is required, not defaulted from Billing Frequency', async () => {
    const input = validSubscription();
    delete (input as { renewalIntervalMonths?: number }).renewalIntervalMonths;
    expect(await validate(input)).toEqual(
      expect.arrayContaining([expect.objectContaining({ property: 'renewalIntervalMonths' })]),
    );
  });

  it('rejects a non-integer custom interval', async () => {
    const input = validSubscription({ renewalIntervalMonths: 18.5 });
    expect(await validate(input)).toEqual(
      expect.arrayContaining([expect.objectContaining({ property: 'renewalIntervalMonths' })]),
    );
  });
});

describe('UpdateSubscriptionDto — an existing modern subscription cannot clear its Renewal Interval', () => {
  it('accepts an update that omits renewalIntervalMonths entirely (leaves it untouched)', async () => {
    const input = Object.assign(new UpdateSubscriptionDto(), { sellingPrice: '150.000' });
    expect(await validate(input)).toEqual([]);
  });

  it('accepts a positive renewalIntervalMonths', async () => {
    const input = Object.assign(new UpdateSubscriptionDto(), { renewalIntervalMonths: 24 });
    expect(await validate(input)).toEqual([]);
  });

  it('rejects renewalIntervalMonths = 0', async () => {
    const input = Object.assign(new UpdateSubscriptionDto(), { renewalIntervalMonths: 0 });
    expect(await validate(input)).toEqual(
      expect.arrayContaining([expect.objectContaining({ property: 'renewalIntervalMonths' })]),
    );
  });

  it('rejects a negative renewalIntervalMonths', async () => {
    const input = Object.assign(new UpdateSubscriptionDto(), { renewalIntervalMonths: -3 });
    expect(await validate(input)).toEqual(
      expect.arrayContaining([expect.objectContaining({ property: 'renewalIntervalMonths' })]),
    );
  });

  // Plain @IsOptional() would NOT have caught this: class-validator treats an explicit `null` the
  // same as "omitted" and skips validation either way, which would have let a caller PATCH
  // `{ renewalIntervalMonths: null }` straight through — clearing an existing modern subscription's
  // Renewal Interval and falling it back into the legacy free-date edit mode. The field uses
  // @ValidateIf(dto => dto.renewalIntervalMonths !== undefined) specifically so an explicit null is
  // rejected while a genuinely omitted field still leaves the existing value untouched.
  it('rejects an explicit null — this is what would otherwise clear an existing Renewal Interval and fall the subscription back into legacy free-date mode', async () => {
    const input = Object.assign(new UpdateSubscriptionDto(), { renewalIntervalMonths: null });
    expect(await validate(input)).toEqual(
      expect.arrayContaining([expect.objectContaining({ property: 'renewalIntervalMonths' })]),
    );
  });
});
