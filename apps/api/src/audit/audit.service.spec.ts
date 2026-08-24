import { jest } from '@jest/globals';
import { ActorType } from '../generated/prisma/enums';
import { AuditService } from './audit.service';

describe('AuditService', () => {
  it('appends an audit event and redacts sensitive nested values', async () => {
    let captured: { data: { metadata: unknown } } | undefined;
    const create = jest.fn((input: unknown) => {
      captured = input as { data: { metadata: unknown } };
      return Promise.resolve({ id: 'audit-id' });
    });
    const prisma = { auditEvent: { create } };
    const service = new AuditService(prisma as never);

    await service.record({
      actorType: ActorType.SYSTEM,
      eventKey: 'foundation.tested',
      subjectType: 'System',
      subjectId: 'phase-0',
      metadata: {
        outcome: 'ok',
        apiKey: 'must-not-appear',
        nested: { password: 'also-secret' },
      },
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(captured?.data.metadata).toEqual({
      outcome: 'ok',
      apiKey: '[REDACTED]',
      nested: { password: '[REDACTED]' },
    });
    expect(JSON.stringify(captured)).not.toContain('must-not-appear');
    expect(JSON.stringify(captured)).not.toContain('also-secret');
  });
});
