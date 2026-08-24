import { jest } from '@jest/globals';
import { IntegrationEnvironment, TechnicalConnectionType } from '../../generated/prisma/enums';
import { TechnicalConnectionsService } from './technical-connections.service';

describe('TechnicalConnectionsService', () => {
  it('encrypts credentials and never returns or audits plaintext/ciphertext', async () => {
    const record = {
      id: 'connection-id',
      code: 'PLESK-01',
      name: 'Plesk 01',
      type: TechnicalConnectionType.PLESK,
      endpoint: 'https://plesk.example.test',
      environment: IntegrationEnvironment.SANDBOX,
      enabled: true,
      capabilities: { suspend: true },
      credentialsCiphertext: 'v1.ciphertext',
      lastHealthStatus: 'UNKNOWN',
      lastHealthCheckedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      _count: { subscriptions: 0 },
    };
    const tx = { technicalConnection: { create: jest.fn(() => Promise.resolve(record)) } };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const secrets = {
      encryptCredentials: jest.fn(() => 'v1.ciphertext'),
    };
    const audit = { record: jest.fn(() => Promise.resolve({ id: 'audit-id' })) };
    const service = new TechnicalConnectionsService(
      prisma as never,
      secrets as never,
      audit as never,
    );

    const result = await service.create(
      {
        code: 'PLESK-01',
        name: 'Plesk 01',
        type: TechnicalConnectionType.PLESK,
        endpoint: 'https://plesk.example.test',
        environment: IntegrationEnvironment.SANDBOX,
        enabled: true,
        capabilities: { suspend: true },
        credentials: { username: 'operator', password: 'do-not-expose' },
      },
      { actorId: 'actor-id' },
    );

    expect(secrets.encryptCredentials).toHaveBeenCalledWith({
      username: 'operator',
      password: 'do-not-expose',
    });
    expect(result.credentials).toBe('********');
    expect(result.credentialsConfigured).toBe(true);
    expect(result).not.toHaveProperty('credentialsCiphertext');
    expect(JSON.stringify(result)).not.toContain('do-not-expose');
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain('do-not-expose');
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain('v1.ciphertext');
  });
});
