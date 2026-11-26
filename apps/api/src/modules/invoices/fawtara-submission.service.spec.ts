import { jest } from '@jest/globals';
import { FawtaraSubmissionService } from './fawtara-submission.service';
import { FawtaraMapper } from './fawtara-mapper';
import { fixture } from './jofotara-test-fixture';
import type { HumanSubmissionContext } from './fawtara-submission.service';
const context: HumanSubmissionContext = {
  actorId: 'admin',
  roles: ['ADMIN'],
  initiation: 'HUMAN',
};
const input = { confirmation: 'CREATE_REAL_JOFOTARA_INVOICE' };
describe('Human-only real submission orchestration (mock gateway)', () => {
  function harness() {
    const i = fixture();
    const c = {
      id: 'conn-a',
      billingEntityId: 'entity-a',
      displayName: 'Device A',
      incomeSourceSequence: '9932895',
      enabled: true,
      productionSubmissionEnabled: true,
      clientIdCiphertext: 'encrypted-client',
      secretKeyCiphertext: 'encrypted-secret',
    };
    let latest: Record<string, unknown> | null = null;
    const tx = {
      $queryRaw: jest.fn(() => Promise.resolve([])),
      invoice: {
        findUnique: jest.fn(() => Promise.resolve(i)),
        updateMany: jest.fn((a: { data: Record<string, unknown> }) => {
          Object.assign(i, a.data);
          return Promise.resolve({ count: 1 });
        }),
      },
      joFotaraConnection: {
        findFirst: jest.fn((a: { where: { id?: string; billingEntityId: string } }) =>
          Promise.resolve(
            a.where.billingEntityId === c.billingEntityId && (!a.where.id || a.where.id === c.id)
              ? c
              : null,
          ),
        ),
        update: jest.fn(() => Promise.resolve(c)),
      },
      fawtaraSubmission: {
        findFirst: jest.fn(() => Promise.resolve(latest)),
        create: jest.fn((a: { data: Record<string, unknown> }) => {
          latest = { id: 'attempt-1', createdAt: new Date(), ...a.data };
          return Promise.resolve(latest);
        }),
        update: jest.fn((a: { data: Record<string, unknown> }) => {
          Object.assign(latest!, a.data);
          return Promise.resolve(latest);
        }),
      },
    };
    const prisma = { ...tx, $transaction: (cb: (client: typeof tx) => unknown) => cb(tx) };
    const audit = { record: jest.fn(() => Promise.resolve()) };
    const invoices = {
      preflight: jest.fn(() => Promise.resolve({ valid: true })),
      findOne: jest.fn(() => Promise.resolve(i)),
    };
    const gateway = {
      submit: jest.fn(() =>
        Promise.resolve({
          status: 'SUBMITTED',
          number: i.internalReference,
          uuid: i.submissionUuid,
          qr: 'official-exact-qr',
          results: { status: 'PASS' },
          message: null,
          httpStatus: 200,
          signedInvoice: undefined as string | undefined,
        }),
      ),
    };
    const service = new FawtaraSubmissionService(
      prisma as never,
      {
        decrypt: (v: string) =>
          v === 'encrypted-client' ? 'client-plaintext' : 'secret-plaintext',
      } as never,
      audit as never,
      invoices as never,
      new FawtaraMapper(),
      gateway as never,
    );
    return { service, i, c, tx, audit, invoices, gateway, get: () => latest };
  }
  it('persists API acceptance, graphical official QR, attempt/connection identity, no credentials in audit/history', async () => {
    const h = harness();
    await h.service.submit(h.i.id, input, context);
    expect(h.i.status).toBe('FAWTARA_ACCEPTED');
    expect(h.i.officializationProvenance).toBe('API');
    expect(h.i.fawtaraQrImageDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(h.get()).toMatchObject({
      outcome: 'ACCEPTED',
      joFotaraConnectionId: 'conn-a',
      officialNumber: h.i.internalReference,
      officialUuid: h.i.submissionUuid,
    });
    const history = JSON.stringify({ attempt: h.get(), audit: h.audit.record.mock.calls });
    expect(history).not.toContain('client-plaintext');
    expect(history).not.toContain('secret-plaintext');
    expect(h.gateway.submit).toHaveBeenCalledTimes(1);
  });
  it.each([
    'enabled',
    'productionSubmissionEnabled',
    'clientIdCiphertext',
    'secretKeyCiphertext',
  ] as const)('blocks missing connection gate %s before HTTP', async (field) => {
    const h = harness();
    Object.assign(h.c, { [field]: field.endsWith('Ciphertext') ? null : false });
    await expect(h.service.submit(h.i.id, input, context)).rejects.toThrow('connection');
    expect(h.gateway.submit).not.toHaveBeenCalled();
  });
  it('blocks another entity connection', async () => {
    const h = harness();
    await expect(
      h.service.submit(h.i.id, { ...input, connectionId: 'entity-b-connection' }, context),
    ).rejects.toThrow('connection');
    expect(h.gateway.submit).not.toHaveBeenCalled();
  });
  it('uses default issuer connection when no selection is given', async () => {
    const h = harness();
    await h.service.submit(h.i.id, input, context);
    expect(h.tx.joFotaraConnection.findFirst).toHaveBeenCalledWith({
      where: { billingEntityId: 'entity-a', defaultEntityKey: 'entity-a' },
    });
  });
  it('uses selected issuer connection and records it', async () => {
    const h = harness();
    await h.service.submit(h.i.id, { ...input, connectionId: 'conn-a' }, context);
    expect(h.get()?.joFotaraConnectionId).toBe('conn-a');
  });
  it('cannot submit draft or failed preflight', async () => {
    const h = harness();
    h.i.status = 'DRAFT';
    await expect(h.service.submit(h.i.id, input, context)).rejects.toThrow('READY');
    expect(h.gateway.submit).not.toHaveBeenCalled();
    const j = harness();
    j.invoices.preflight.mockResolvedValue({ valid: false });
    await expect(j.service.submit(j.i.id, input, context)).rejects.toThrow('preflight');
    expect(j.gateway.submit).not.toHaveBeenCalled();
  });
  it('requires explicit confirmation', async () => {
    const h = harness();
    await expect(h.service.submit(h.i.id, { confirmation: 'yes' }, context)).rejects.toThrow(
      'confirmation',
    );
    expect(h.gateway.submit).not.toHaveBeenCalled();
  });
  it.each(['IT', 'MANAGEMENT', 'AI', 'WORKER'])('blocks role %s', async (role) => {
    const h = harness();
    await expect(h.service.submit(h.i.id, input, { ...context, roles: [role] })).rejects.toThrow(
      'human',
    );
    expect(h.gateway.submit).not.toHaveBeenCalled();
  });
  it('blocks non-human initiation even with the ADMIN role', async () => {
    const h = harness();
    await expect(
      h.service.submit(h.i.id, input, { ...context, initiation: 'WORKER' as 'HUMAN' }),
    ).rejects.toThrow('human');
  });
  it('blocks a legacy accountant before preflight or submission', async () => {
    const h = harness();
    await expect(h.service.submit(h.i.id, input, { ...context, roles: ['ACCOUNTANT'] }))
      .rejects.toThrow('Only an authorized human');
    expect(h.invoices.preflight).not.toHaveBeenCalled();
    expect(h.gateway.submit).not.toHaveBeenCalled();
  });
  it('HTTP success with rejected status does not accept', async () => {
    const h = harness();
    h.gateway.submit.mockResolvedValue({ ...(await h.gateway.submit()), status: 'NOT_SUBMITTED' });
    h.gateway.submit.mockClear();
    await h.service.submit(h.i.id, input, context);
    expect(h.i.status).toBe('FAWTARA_REJECTED');
    expect(h.get()?.outcome).toBe('REJECTED');
    expect(h.i.officializationProvenance).toBeUndefined();
  });
  it('uncertain outcome keeps lock, blocks replacement, and only explicit recovery reuses original XML', async () => {
    const h = harness();
    h.gateway.submit.mockRejectedValueOnce(new Error('timeout'));
    await expect(h.service.submit(h.i.id, input, context)).rejects.toThrow('unknown');
    const xml = h.get()?.requestXml;
    expect(h.get()?.outcome).toBe('UNKNOWN');
    expect(h.i.submissionLock).toBeTruthy();
    await expect(h.service.submit(h.i.id, input, context)).rejects.toThrow(
      'pending or outcome unknown',
    );
    await h.service.submit(
      h.i.id,
      { ...input, recoverUncertain: true, connectionId: 'changed-default' },
      context,
    );
    expect(h.invoices.preflight).toHaveBeenLastCalledWith(h.i.id);
    expect(h.tx.joFotaraConnection.findFirst).toHaveBeenLastCalledWith({
      where: { billingEntityId: 'entity-a', id: 'conn-a' },
    });
    expect(h.get()?.requestXml).toBe(xml);
    expect(h.gateway.submit).toHaveBeenCalledTimes(2);
  });
  it('signed official discrepancy blocks normal final printing pending reconciliation', async () => {
    const h = harness();
    const result = await h.gateway.submit();
    const xml = new FawtaraMapper()
      .map(h.i, h.c.incomeSourceSequence)
      .xml.replaceAll('104.400', '105.400')
      .replaceAll('14.400', '15.400');
    h.gateway.submit.mockResolvedValue({
      ...result,
      signedInvoice: Buffer.from(xml).toString('base64'),
    });
    await h.service.submit(h.i.id, input, context);
    expect(h.i.reconciliationRequired).toBe(true);
    expect(h.i.grandTotal.toString()).toBe('104.400');
    expect(h.i.officialGrandTotal?.toString()).toBe('105.400');
  });
});
