import { jest } from '@jest/globals';
import { CustomerEmailResolutionService } from './customer-email-resolution.service';

function harness(options: {
  activePrimary?: { email: string } | null;
  anyChannel?: { id: string } | null;
  scalarPrimaryEmail?: string | null;
}) {
  const prisma = {
    customerEmailAddress: {
      findFirst: jest
        .fn<() => Promise<{ email: string } | { id: string } | null>>()
        // First call resolves the active-primary lookup, second call resolves the
        // any-channel-exists lookup — matching call order in the service implementation.
        .mockResolvedValueOnce(options.activePrimary ?? null)
        .mockResolvedValueOnce(options.anyChannel ?? null),
    },
    customer: {
      findUnique: jest.fn(() =>
        Promise.resolve(
          options.scalarPrimaryEmail === undefined
            ? null
            : { primaryEmail: options.scalarPrimaryEmail },
        ),
      ),
    },
  };
  return { service: new CustomerEmailResolutionService(prisma as never), prisma };
}

describe('CustomerEmailResolutionService', () => {
  it('tier 1: an active normalized primary always wins', async () => {
    const { service, prisma } = harness({ activePrimary: { email: 'new@example.test' } });

    const result = await service.resolvePrimaryRecipient('customer-id');

    expect(result).toEqual({ email: 'new@example.test', source: 'NORMALIZED_PRIMARY' });
    // No need to fall through to the any-channel or scalar lookups once tier 1 resolves.
    expect(prisma.customer.findUnique).not.toHaveBeenCalled();
  });

  it('tier 2: falls back to the legacy scalar only when no normalized channel exists at all', async () => {
    const { service } = harness({
      activePrimary: null,
      anyChannel: null,
      scalarPrimaryEmail: 'legacy@example.test',
    });

    const result = await service.resolvePrimaryRecipient('customer-id');

    expect(result).toEqual({ email: 'legacy@example.test', source: 'LEGACY_SCALAR_FALLBACK' });
  });

  it('tier 3: refuses to fall back to the scalar once normalized channel data exists and says no', async () => {
    const { service, prisma } = harness({
      activePrimary: null,
      anyChannel: { id: 'some-inactive-or-demoted-channel' },
      scalarPrimaryEmail: 'stale@example.test',
    });

    const result = await service.resolvePrimaryRecipient('customer-id');

    expect(result).toBeNull();
    // The whole point of tier 3: never even reads the scalar once we know normalized data exists.
    expect(prisma.customer.findUnique).not.toHaveBeenCalled();
  });

  it('returns null when no normalized channel and no scalar exist either', async () => {
    const { service } = harness({ activePrimary: null, anyChannel: null });

    await expect(service.resolvePrimaryRecipient('customer-id')).resolves.toBeNull();
  });

  it('accepts an explicit Prisma client (e.g. a transaction) instead of always using the default one', async () => {
    const tx = {
      customerEmailAddress: {
        findFirst: jest.fn(() => Promise.resolve({ email: 'tx@example.test' })),
      },
      customer: { findUnique: jest.fn() },
    };
    const prisma = { customerEmailAddress: { findFirst: jest.fn() }, customer: { findUnique: jest.fn() } };
    const service = new CustomerEmailResolutionService(prisma as never);

    const result = await service.resolvePrimaryRecipient('customer-id', tx as never);

    expect(result).toEqual({ email: 'tx@example.test', source: 'NORMALIZED_PRIMARY' });
    expect(prisma.customerEmailAddress.findFirst).not.toHaveBeenCalled();
    expect(tx.customerEmailAddress.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { customerId: 'customer-id', primary: true, active: true } }),
    );
  });
});
