import { jest } from '@jest/globals';
import { Prisma } from '../../generated/prisma/client';
import { MailThreadResolutionService } from './mail-thread-resolution.service';

const params = {
  renewalCaseId: 'case-1',
  customerId: 'customer-1',
  mailConfigurationId: 'config-1',
  subject: 'Renewal for Hosting Plan',
  occurredAt: new Date('2026-09-01T00:00:00.000Z'),
};

describe('MailThreadResolutionService', () => {
  it('returns the existing thread without attempting a create', async () => {
    const existing = { id: 'thread-1', renewalCaseId: 'case-1' };
    const tx = {
      communicationThread: {
        findUnique: jest.fn(() => Promise.resolve(existing)),
        create: jest.fn(),
      },
    };
    const prisma = { communicationThread: { findUniqueOrThrow: jest.fn() } };
    const service = new MailThreadResolutionService(prisma as never);

    const result = await service.resolveOrCreate(tx as never, params);

    expect(result).toBe(existing);
    expect(tx.communicationThread.create).not.toHaveBeenCalled();
  });

  it('creates a new thread when none exists', async () => {
    const created = { id: 'thread-2', renewalCaseId: 'case-1' };
    const tx = {
      communicationThread: {
        findUnique: jest.fn(() => Promise.resolve(null)),
        create: jest.fn(() => Promise.resolve(created)),
      },
    };
    const prisma = { communicationThread: { findUniqueOrThrow: jest.fn() } };
    const service = new MailThreadResolutionService(prisma as never);

    const result = await service.resolveOrCreate(tx as never, params);

    expect(result).toBe(created);
    expect(tx.communicationThread.create).toHaveBeenCalledWith({
      data: {
        renewalCaseId: params.renewalCaseId,
        customerId: params.customerId,
        mailConfigurationId: params.mailConfigurationId,
        subject: params.subject,
        lastMessageAt: params.occurredAt,
      },
    });
  });

  it('recovers via a fresh (non-tx) lookup when a concurrent worker wins the unique-constraint race', async () => {
    // Deliberately NOT read through `tx` — see the service's own doc comment: under MariaDB
    // REPEATABLE READ, tx's snapshot predates the winner's commit and would not see it. The fake
    // tx here has no findUniqueOrThrow at all, so this test would fail loudly if the service ever
    // regressed to reading the recovery lookup through tx again.
    const winner = { id: 'thread-3', renewalCaseId: 'case-1' };
    const conflict = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'test',
    });
    const tx = {
      communicationThread: {
        findUnique: jest.fn(() => Promise.resolve(null)),
        create: jest.fn(() => Promise.reject(conflict)),
      },
    };
    const findUniqueOrThrow = jest.fn(() => Promise.resolve(winner));
    const prisma = { communicationThread: { findUniqueOrThrow } };
    const service = new MailThreadResolutionService(prisma as never);

    const result = await service.resolveOrCreate(tx as never, params);

    expect(result).toBe(winner);
    expect(findUniqueOrThrow).toHaveBeenCalledWith({ where: { renewalCaseId: params.renewalCaseId } });
  });

  it('rethrows a non-unique-constraint error from create', async () => {
    const error = new Error('connection lost');
    const tx = {
      communicationThread: {
        findUnique: jest.fn(() => Promise.resolve(null)),
        create: jest.fn(() => Promise.reject(error)),
      },
    };
    const prisma = { communicationThread: { findUniqueOrThrow: jest.fn() } };
    const service = new MailThreadResolutionService(prisma as never);

    await expect(service.resolveOrCreate(tx as never, params)).rejects.toBe(error);
  });
});
