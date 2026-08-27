import { jest } from '@jest/globals';
import { PackageKind } from '../../generated/prisma/enums';
import { ServicePackagesService } from './service-packages.service';

describe('ServicePackagesService', () => {
  it('creates catalog terms transactionally and audits the change', async () => {
    const created = {
      id: 'package-id',
      code: 'TEST_PACKAGE',
      name: 'Test Package',
      terms: [{ termMonths: 12, currency: 'JOD', standardSellingPrice: '10.000' }],
    };
    type CreateArgs = { data: { specifications?: unknown; terms?: { create: unknown[] } } };
    const create = jest.fn<(input: CreateArgs) => Promise<typeof created>>(() =>
      Promise.resolve(created),
    );
    const tx = { servicePackage: { create } };
    const prisma = {
      serviceType: { findUnique: jest.fn(() => Promise.resolve({ active: true })) },
      $transaction: jest.fn((callback: (value: typeof tx) => unknown) =>
        Promise.resolve(callback(tx)),
      ),
    };
    const audit = { record: jest.fn(() => Promise.resolve(undefined)) };
    const service = new ServicePackagesService(prisma as never, audit as never);
    await expect(
      service.create(
        {
          serviceTypeId: '00000000-0000-4000-8000-000000000001',
          code: 'TEST_PACKAGE',
          name: 'Test Package',
          kind: PackageKind.STANDARD,
          specifications: { storageGb: 10 },
          terms: [{ termMonths: 12, currency: 'JOD', standardSellingPrice: '10.000' }],
        },
        { actorId: 'actor' },
      ),
    ).resolves.toEqual(created);
    const createInput = create.mock.calls[0]?.[0];
    expect(createInput?.data.specifications).toEqual({ storageGb: 10 });
    expect(createInput?.data.terms).toEqual({
      create: [{ termMonths: 12, currency: 'JOD', standardSellingPrice: '10.000' }],
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventKey: 'service_package.created', subjectId: 'package-id' }),
      tx,
    );
  });
});
