import { jest } from '@jest/globals';
import { HttpStatus } from '@nestjs/common';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('returns service unavailable when a required dependency is down', async () => {
    const result = {
      status: 'degraded' as const,
      services: { database: { status: 'down' as const }, redis: { status: 'up' as const } },
    };
    const health = { readiness: jest.fn(() => Promise.resolve(result)) };
    const response = { status: jest.fn() };
    const body = await new HealthController(health as never).readiness(response as never);

    expect(response.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    expect(body).toBe(result);
  });
});
