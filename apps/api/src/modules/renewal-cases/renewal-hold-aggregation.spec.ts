import { aggregateEffectiveHolds } from './renewal-policy';

const asOf = new Date('2026-08-24T08:00:00.000Z');

function hold(
  id: string,
  stopsCustomerReminders: boolean,
  stopsInternalNotifications: boolean,
  overrides: Partial<{ active: boolean; expiresAt: Date | null }> = {},
) {
  return {
    id,
    active: overrides.active ?? true,
    expiresAt: overrides.expiresAt ?? null,
    stopsCustomerReminders,
    stopsInternalNotifications,
  };
}

describe('renewal hold aggregation', () => {
  it('suppresses only customer reminders for a customer-only active hold', () => {
    expect(aggregateEffectiveHolds([hold('customer', true, false)], asOf)).toEqual({
      effectiveHoldIds: ['customer'],
      customerReminderHoldIds: ['customer'],
      internalNotificationHoldIds: [],
      stopCustomerReminders: true,
      stopInternalNotifications: false,
    });
  });

  it('suppresses only internal notifications for an internal-only active hold', () => {
    expect(aggregateEffectiveHolds([hold('internal', false, true)], asOf)).toEqual({
      effectiveHoldIds: ['internal'],
      customerReminderHoldIds: [],
      internalNotificationHoldIds: ['internal'],
      stopCustomerReminders: false,
      stopInternalNotifications: true,
    });
  });

  it('aggregates split suppression across simultaneous active holds', () => {
    const result = aggregateEffectiveHolds(
      [hold('customer', true, false), hold('internal', false, true)],
      asOf,
    );
    expect(result.stopCustomerReminders).toBe(true);
    expect(result.stopInternalNotifications).toBe(true);
    expect(result.effectiveHoldIds).toEqual(['customer', 'internal']);
  });

  it('ignores an expired hold while preserving an active hold', () => {
    const result = aggregateEffectiveHolds(
      [
        hold('active', true, false),
        hold('expired', false, true, { expiresAt: new Date('2026-08-24T07:59:59.999Z') }),
      ],
      asOf,
    );
    expect(result.effectiveHoldIds).toEqual(['active']);
    expect(result.stopCustomerReminders).toBe(true);
    expect(result.stopInternalNotifications).toBe(false);
  });

  it('ignores a released hold while preserving an active hold', () => {
    const result = aggregateEffectiveHolds(
      [hold('active', false, true), hold('released', true, false, { active: false })],
      asOf,
    );
    expect(result.effectiveHoldIds).toEqual(['active']);
    expect(result.stopCustomerReminders).toBe(false);
    expect(result.stopInternalNotifications).toBe(true);
  });

  it('retains both relevant IDs when two holds suppress the same category', () => {
    const result = aggregateEffectiveHolds(
      [hold('second', true, false), hold('first', true, false)],
      asOf,
    );
    expect(result.customerReminderHoldIds).toEqual(['first', 'second']);
    expect(result.stopCustomerReminders).toBe(true);
    expect(result.stopInternalNotifications).toBe(false);
  });

  it('keeps suppression imposed by another hold after one hold is released', () => {
    const result = aggregateEffectiveHolds(
      [hold('released', true, false, { active: false }), hold('remaining', true, false)],
      asOf,
    );
    expect(result.customerReminderHoldIds).toEqual(['remaining']);
    expect(result.stopCustomerReminders).toBe(true);
  });
});
