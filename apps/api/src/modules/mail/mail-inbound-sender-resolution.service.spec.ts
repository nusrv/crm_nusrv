import { jest } from '@jest/globals';
import { CustomerStatus } from '../../generated/prisma/enums';
import { MailInboundSenderResolutionService } from './mail-inbound-sender-resolution.service';

interface FakeChannelRow {
  customerId: string;
  email: string;
  active: boolean;
}

interface FakeCustomer {
  id: string;
  status: CustomerStatus;
  primaryEmail: string;
}

function harness(channels: FakeChannelRow[], customers: FakeCustomer[]) {
  const customerEmailAddress = {
    findMany: jest.fn(({ where }: { where: { email: string; active: boolean } }) =>
      Promise.resolve(
        channels
          .filter((row) => row.email === where.email && row.active === where.active)
          .map((row) => ({ customerId: row.customerId })),
      ),
    ),
    findFirst: jest.fn(({ where }: { where: { customerId: string } }) => {
      const match = channels.find((row) => row.customerId === where.customerId);
      return Promise.resolve(match ? { id: `${match.customerId}-channel` } : null);
    }),
  };
  const customer = {
    findMany: jest.fn(({ where }: { where: { primaryEmail: string } }) =>
      Promise.resolve(
        customers
          .filter((c) => c.primaryEmail === where.primaryEmail)
          .map((c) => ({ id: c.id, status: c.status })),
      ),
    ),
    findUniqueOrThrow: jest.fn(({ where }: { where: { id: string } }) => {
      const found = customers.find((c) => c.id === where.id);
      if (!found) throw new Error('not found');
      return Promise.resolve({ status: found.status });
    }),
  };
  const prisma = { customerEmailAddress, customer };
  return { service: new MailInboundSenderResolutionService(prisma as never) };
}

describe('MailInboundSenderResolutionService', () => {
  it('returns unique (NORMALIZED_CHANNEL) via an active channel match, normalizing the sender address', async () => {
    const { service } = harness(
      [{ customerId: 'cust-1', email: 'someone@example.com', active: true }],
      [{ id: 'cust-1', status: CustomerStatus.ACTIVE, primaryEmail: 'old@example.com' }],
    );
    const result = await service.resolveSenderCustomer('  SomeOne@Example.com  ');
    expect(result).toEqual({
      outcome: 'unique',
      customerId: 'cust-1',
      customerStatus: CustomerStatus.ACTIVE,
      source: 'NORMALIZED_CHANNEL',
    });
  });

  it('returns unique and preserves attribution for an INACTIVE customer (caller marks HUMAN_REVIEW)', async () => {
    const { service } = harness(
      [{ customerId: 'cust-1', email: 'someone@example.com', active: true }],
      [{ id: 'cust-1', status: CustomerStatus.INACTIVE, primaryEmail: 'old@example.com' }],
    );
    const result = await service.resolveSenderCustomer('someone@example.com');
    expect(result).toEqual({
      outcome: 'unique',
      customerId: 'cust-1',
      customerStatus: CustomerStatus.INACTIVE,
      source: 'NORMALIZED_CHANNEL',
    });
  });

  it('returns ambiguous when the same normalized address is an active channel for two customers', async () => {
    const { service } = harness(
      [
        { customerId: 'cust-1', email: 'shared@example.com', active: true },
        { customerId: 'cust-2', email: 'shared@example.com', active: true },
      ],
      [],
    );
    const result = await service.resolveSenderCustomer('shared@example.com');
    expect(result).toEqual({ outcome: 'ambiguous' });
  });

  it('never lets an inactive channel match count as a resolution', async () => {
    const { service } = harness(
      [{ customerId: 'cust-1', email: 'someone@example.com', active: false }],
      [],
    );
    const result = await service.resolveSenderCustomer('someone@example.com');
    expect(result).toEqual({ outcome: 'unattributed' });
  });

  it('falls back to the legacy primaryEmail scalar only when the customer has zero channel rows', async () => {
    const { service } = harness(
      [],
      [{ id: 'cust-1', status: CustomerStatus.ACTIVE, primaryEmail: 'legacy@example.com' }],
    );
    const result = await service.resolveSenderCustomer('legacy@example.com');
    expect(result).toEqual({
      outcome: 'unique',
      customerId: 'cust-1',
      customerStatus: CustomerStatus.ACTIVE,
      source: 'LEGACY_SCALAR_FALLBACK',
    });
  });

  it('never uses the legacy scalar fallback when the customer has any channel row at all (even a non-matching one)', async () => {
    const { service } = harness(
      [{ customerId: 'cust-1', email: 'other@example.com', active: true }],
      [{ id: 'cust-1', status: CustomerStatus.ACTIVE, primaryEmail: 'legacy@example.com' }],
    );
    const result = await service.resolveSenderCustomer('legacy@example.com');
    expect(result).toEqual({ outcome: 'unattributed' });
  });

  it('returns ambiguous when two customers with no channel rows share the same legacy primaryEmail', async () => {
    const { service } = harness(
      [],
      [
        { id: 'cust-1', status: CustomerStatus.ACTIVE, primaryEmail: 'dup@example.com' },
        { id: 'cust-2', status: CustomerStatus.ACTIVE, primaryEmail: 'dup@example.com' },
      ],
    );
    const result = await service.resolveSenderCustomer('dup@example.com');
    expect(result).toEqual({ outcome: 'ambiguous' });
  });

  it('returns unattributed for a completely unknown sender', async () => {
    const { service } = harness([], []);
    const result = await service.resolveSenderCustomer('nobody@example.com');
    expect(result).toEqual({ outcome: 'unattributed' });
  });
});
