import { jest } from '@jest/globals';
import { HealthService } from './health.service';

describe('HealthService', () => {
  it('reports component state without exposing MariaDB connection details or errors', async () => {
    const prisma = {
      $queryRaw: jest.fn(() => Promise.reject(new Error('mysql://user:secret@mariadb'))),
    };
    const redis = { ping: jest.fn(() => Promise.resolve('PONG')) };
    const result = await new HealthService(prisma as never, redis as never).readiness();

    expect(result).toEqual({
      status: 'degraded',
      services: { database: { status: 'down' }, redis: { status: 'up' } },
    });
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(JSON.stringify(result)).not.toContain('mysql');
    expect(JSON.stringify(result)).not.toContain('mariadb');
  });
});
