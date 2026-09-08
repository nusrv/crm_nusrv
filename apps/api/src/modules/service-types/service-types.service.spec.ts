import { jest } from '@jest/globals';
import { ServiceTypesService } from './service-types.service';

describe('ServiceTypesService.list', () => {
  it('returns a plain array, not a paginated { data, meta } envelope', async () => {
    // apps/web/components/renewal-cases-manager.tsx once assumed this endpoint was paginated
    // like /renewal-cases and /communication-outbox, called .data on the plain array response,
    // got undefined, and crashed the page on the next .map(). Pin the actual contract here so a
    // future change to this shape (in either direction) is caught before it reaches a consumer.
    const serviceTypes = [{ id: 'type-id', code: 'HOSTING', name: 'Hosting', active: true }];
    const findMany = jest.fn(() => Promise.resolve(serviceTypes));
    const prisma = { serviceType: { findMany } };
    const service = new ServiceTypesService(prisma as never, {} as never);

    const result = await service.list();

    expect(Array.isArray(result)).toBe(true);
    expect(result).not.toHaveProperty('data');
    expect(result).not.toHaveProperty('meta');
    expect(result).toBe(serviceTypes);
  });
});
