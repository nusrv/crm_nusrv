import { jest } from '@jest/globals';
import { RenewalCasesService } from './renewal-cases.service';

describe('RenewalCasesService holds', () => {
  const now = new Date('2026-08-24T08:00:00.000Z');

  it('creates an expiring hold and audits its policy without changing the due date', async () => {
    const hold = {
      id: 'hold-id',
      renewalCaseId: 'case-id',
      reason: 'Awaiting customer clarification',
      stopsCustomerReminders: true,
      stopsInternalNotifications: false,
      expiresAt: new Date('2026-08-25T08:00:00.000Z'),
      active: true,
      createdById: 'actor-id',
    };
    const tx = { renewalHold: { create: jest.fn(() => Promise.resolve(hold)) } };
    const prisma = {
      renewalCase: { findUnique: jest.fn(() => Promise.resolve({ id: 'case-id' })) },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const audit = { record: jest.fn(() => Promise.resolve({ id: 'audit-id' })) };
    const service = new RenewalCasesService(
      prisma as never,
      audit as never,
      { now: () => now },
      {} as never,
    );
    const result = await service.createHold(
      'case-id',
      {
        reason: hold.reason,
        stopsCustomerReminders: true,
        stopsInternalNotifications: false,
        expiresAt: hold.expiresAt.toISOString(),
      },
      { actorId: 'actor-id' },
    );
    expect(result).toBe(hold);
    expect(JSON.stringify(tx.renewalHold.create.mock.calls)).not.toContain('dueDate');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventKey: 'renewal.hold.created' }),
      tx,
    );
  });

  it('releases an active hold with actor and timestamp audit data', async () => {
    const oldState = { id: 'hold-id', renewalCaseId: 'case-id', active: true };
    const released = { ...oldState, active: false, releasedById: 'actor-id', releasedAt: now };
    const tx = { renewalHold: { update: jest.fn(() => Promise.resolve(released)) } };
    const prisma = {
      renewalHold: { findFirst: jest.fn(() => Promise.resolve(oldState)) },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const audit = { record: jest.fn(() => Promise.resolve({ id: 'audit-id' })) };
    const service = new RenewalCasesService(
      prisma as never,
      audit as never,
      { now: () => now },
      {} as never,
    );
    expect(await service.releaseHold('case-id', 'hold-id', { actorId: 'actor-id' })).toBe(released);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventKey: 'renewal.hold.released' }),
      tx,
    );
  });

  it('rejects a hold that already expired according to the injectable clock', async () => {
    const prisma = {
      renewalCase: { findUnique: jest.fn(() => Promise.resolve({ id: 'case-id' })) },
    };
    const service = new RenewalCasesService(
      prisma as never,
      { record: jest.fn() } as never,
      { now: () => now },
      {} as never,
    );
    await expect(
      service.createHold(
        'case-id',
        {
          reason: 'Expired',
          expiresAt: '2026-08-24T07:00:00.000Z',
          stopsCustomerReminders: true,
          stopsInternalNotifications: true,
        },
        { actorId: 'actor-id' },
      ),
    ).rejects.toThrow('Hold expiration must be in the future');
  });
});
