import { jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import { SecretEncryptionService } from '../../security/secret-encryption.service';
import { JoFotaraConnectionsService } from './jofotara-connections.service';
import type { SaveJoFotaraConnectionDto } from './jofotara-connections.dto';
const secrets = new SecretEncryptionService(
  new ConfigService({ ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 7).toString('base64') }),
);
describe('JoFotara independent connections', () => {
  function harness() {
    const rows: Array<Record<string, unknown>> = [];
    const audit = { record: jest.fn(() => Promise.resolve()) };
    const tx = {
      $queryRaw: jest.fn(() => Promise.resolve([])),
      billingEntity: { findUnique: jest.fn(() => Promise.resolve({ id: 'entity-a' })) },
      joFotaraConnection: {
        findFirst: jest.fn((a: { where: { id: string; billingEntityId: string } }) =>
          Promise.resolve(
            rows.find((r) => r.id === a.where.id && r.billingEntityId === a.where.billingEntityId),
          ),
        ),
        create: jest.fn((a: { data: Record<string, unknown> }) => {
          const row = { id: `conn-${rows.length + 1}`, lastUsedAt: null, ...a.data };
          rows.push(row);
          return Promise.resolve(row);
        }),
        update: jest.fn((a: { where: { id: string }; data: Record<string, unknown> }) => {
          const row = rows.find((r) => r.id === a.where.id)!;
          Object.assign(row, a.data);
          return Promise.resolve(row);
        }),
        updateMany: jest.fn(() => {
          rows.forEach((r) => (r.defaultEntityKey = null));
          return Promise.resolve({ count: rows.length });
        }),
        findMany: jest.fn(() => Promise.resolve(rows)),
      },
    };
    const prisma = { ...tx, $transaction: (cb: (client: typeof tx) => unknown) => cb(tx) };
    return {
      service: new JoFotaraConnectionsService(prisma as never, secrets, audit as never),
      rows,
      audit,
    };
  }
  const input: SaveJoFotaraConnectionDto = {
    displayName: 'Device A',
    incomeSourceSequence: '123',
    clientId: 'client-plaintext',
    secretKey: 'secret-plaintext',
    isDefault: true,
  };
  it('encrypts both credentials, masks GET/list and audit, defaults production OFF, and saves without networking', async () => {
    const h = harness();
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('Network forbidden'));
    try {
      const view = await h.service.save('entity-a', null, input, { actorId: 'admin' });
      expect(view.productionSubmissionEnabled).toBe(false);
      expect(secrets.decrypt(h.rows[0]!.secretKeyCiphertext as string)).toBe('secret-plaintext');
      expect(secrets.decrypt(h.rows[0]!.clientIdCiphertext as string)).toBe('client-plaintext');
      const exposed = JSON.stringify({
        view,
        list: await h.service.list('entity-a'),
        audit: h.audit.record.mock.calls,
      });
      expect(exposed).not.toContain('secret-plaintext');
      expect(exposed).not.toContain('client-plaintext');
      expect(exposed).not.toContain('Ciphertext');
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
  it('preserves multiple devices independently and changes the single default', async () => {
    const h = harness();
    await h.service.save('entity-a', null, input, { actorId: 'admin' });
    const first = h.rows[0]!.secretKeyCiphertext;
    await h.service.save(
      'entity-a',
      null,
      {
        ...input,
        displayName: 'Device B',
        incomeSourceSequence: '456',
        secretKey: 'second-secret',
      },
      { actorId: 'admin' },
    );
    expect(h.rows).toHaveLength(2);
    expect(h.rows[0]!.secretKeyCiphertext).toBe(first);
    expect(h.rows[0]!.defaultEntityKey).toBeNull();
    expect(h.rows[1]!.defaultEntityKey).toBe('entity-a');
    expect(h.rows[0]!.incomeSourceSequence).toBe('123');
  });
  it('does not edit another Billing Entity connection', async () => {
    const h = harness();
    await h.service.save('entity-a', null, input, { actorId: 'admin' });
    await expect(
      h.service.save('entity-b', 'conn-1', { displayName: 'Attack' }, { actorId: 'admin' }),
    ).rejects.toThrow('not found in this Billing Entity');
  });
  it('disabling removes default selection without deleting the device', async () => {
    const h = harness();
    await h.service.save('entity-a', null, input, { actorId: 'admin' });
    await h.service.save('entity-a', 'conn-1', { enabled: false }, { actorId: 'admin' });
    expect(h.rows).toHaveLength(1);
    expect(h.rows[0]!.defaultEntityKey).toBeNull();
  });
});
