import { PNG } from 'pngjs';
import { jest } from '@jest/globals';
import { defaultInvoiceVisibility, effectiveInvoiceVisibility } from '@cp/shared';
import { snapshotPresentation } from './invoice-branding.schema';
import { InvoiceBrandingService, validateLogo } from './invoice-branding.service';
import { InvoiceBrandingController } from './invoice-branding.controller';
import { REQUIRED_ROLES_KEY } from '../../identity/auth.constants';
const pixel = new PNG({ width: 1, height: 1 });
pixel.data[3] = 255;
const png = PNG.sync.write(pixel);
const context = { actorId: 'admin' };
function harness() {
  let entity: Record<string, unknown> = {
    id: 'issuer-a',
    code: 'PERSON',
    issuerType: 'INDIVIDUAL',
    legalName: 'Personal Legal Name',
    legalNameAr: null,
    address: 'Seller address',
    countryCode: 'JO',
    taxNumber: null,
    invoiceEmail: 'person@example.test',
    bankDetailsCiphertext: 'secret-envelope-must-not-leak',
    invoiceBranding: null,
  };
  const assets: Array<{
    id: string;
    billingEntityId: string;
    bytes: Uint8Array;
    sha256: string;
    mimeType: string;
  }> = [];
  const audit = { record: jest.fn(() => Promise.resolve()) };
  const tx = {
    $queryRaw: jest.fn(() => Promise.resolve([])),
    billingEntity: {
      findUnique: jest.fn(() => {
        const e = structuredClone(entity);
        const p = e.invoiceBranding as { logoAssetId: string | null; logoAsset?: unknown } | null;
        if (p) p.logoAsset = assets.find((a) => a.id === p.logoAssetId) ?? null;
        return Promise.resolve(e);
      }),
      update: jest.fn((args: { data: Record<string, unknown> }) => {
        entity = { ...entity, ...args.data };
        return Promise.resolve(entity);
      }),
    },
    invoiceBrandingProfile: {
      upsert: jest.fn(
        (args: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
          const old = entity.invoiceBranding as { revision: number } | null;
          const next = old
            ? { ...old, ...args.update, revision: old.revision + 1 }
            : { ...args.create };
          entity = { ...entity, invoiceBranding: next };
          return Promise.resolve(next);
        },
      ),
    },
    invoiceBrandingAsset: {
      findFirst: jest.fn((args: { where: { id: string; billingEntityId: string } }) =>
        Promise.resolve(
          assets.find(
            (a) => a.id === args.where.id && a.billingEntityId === args.where.billingEntityId,
          ) ?? null,
        ),
      ),
      upsert: jest.fn(
        (args: {
          where: { billingEntityId_sha256: { billingEntityId: string; sha256: string } };
          create: Omit<(typeof assets)[number], 'id'>;
          update: object;
        }) => {
          const key = args.where.billingEntityId_sha256;
          let asset = assets.find(
            (a) => a.billingEntityId === key.billingEntityId && a.sha256 === key.sha256,
          );
          if (!asset) {
            asset = { id: `asset-${assets.length + 1}`, ...args.create };
            assets.push(asset);
          }
          return Promise.resolve(asset);
        },
      ),
    },
  };
  const prisma = { ...tx, $transaction: (cb: (client: typeof tx) => unknown) => cb(tx) };
  return {
    service: new InvoiceBrandingService(prisma as never, audit as never),
    tx,
    audit,
    assets,
    get: () => entity,
  };
}
const input = {
  expectedRevision: 0,
  issuerType: 'INDIVIDUAL',
  legalName: 'Personal Legal Name',
  legalNameAr: null,
  address: 'Seller address',
  countryCode: 'JO',
  taxNumber: null,
  invoiceEmail: 'person@example.test',
  logoAssetId: null,
  details: {},
  visibility: defaultInvoiceVisibility(),
};
describe('Issuer branding profiles and retention', () => {
  it('supports individual identity without a company logo/bank/Arabic identity/tax fabrication', async () => {
    const h = harness();
    const result = await h.service.save('issuer-a', input, context);
    expect(result.issuerType).toBe('INDIVIDUAL');
    expect(result.taxNumber).toBeNull();
    expect(result.logoAssetId).toBeNull();
    expect(result.details).toEqual({});
    expect(result.expectedRevision).toBe(1);
  });
  it('copies defaults into a detached snapshot, preserving old visibility/details after profile changes', () => {
    const profile = {
      revision: 1,
      logoAssetId: 'old-logo',
      details: { phone: 'old-phone', jodIban: 'old-bank' },
      visibility: defaultInvoiceVisibility(),
    };
    const snapshot = snapshotPresentation({ issuerType: 'INDIVIDUAL', countryCode: 'JO' }, profile);
    profile.details.phone = 'new-phone';
    profile.details.jodIban = 'new-bank';
    profile.visibility.logo = false;
    profile.logoAssetId = 'new-logo';
    expect(snapshot.details.phone).toBe('old-phone');
    expect(snapshot.logoAssetId).toBe('old-logo');
    expect(snapshot.visibility.logo).toBe(true);
  });
  it('official print requirements override hiding while draft visibility remains flexible', () => {
    const flags = {
      ...defaultInvoiceVisibility(),
      nameEn: false,
      address: false,
      taxNumber: false,
      logo: false,
      phone: false,
    };
    expect(effectiveInvoiceVisibility(flags, false).taxNumber).toBe(false);
    expect(effectiveInvoiceVisibility(flags, true)).toMatchObject({
      nameEn: true,
      address: true,
      taxNumber: true,
      logo: false,
      phone: false,
    });
    expect(flags.taxNumber).toBe(false);
  });
  it('stores immutable deduplicated logo bytes separately, retaining earlier versions', async () => {
    const h = harness();
    const first = await h.service.uploadLogo(
      'issuer-a',
      { buffer: png, mimetype: 'image/png' },
      context,
    );
    const duplicate = await h.service.uploadLogo(
      'issuer-a',
      { buffer: png, mimetype: 'image/png' },
      context,
    );
    const replacement = new PNG({ width: 1, height: 1 });
    replacement.data[0] = 255;
    replacement.data[3] = 255;
    const next = PNG.sync.write(replacement);
    await h.service.uploadLogo('issuer-a', { buffer: next, mimetype: 'image/png' }, context);
    expect(first.id).toBe(duplicate.id);
    expect(h.assets).toHaveLength(2);
    expect(Buffer.from(h.assets[0]!.bytes)).toEqual(png);
    expect(h.tx.invoiceBrandingAsset.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: {} }),
    );
    expect(h.get().invoiceBranding).toBeNull();
  });
  it.each([
    { buffer: Buffer.from('<svg/>'), mimetype: 'image/svg+xml' },
    { buffer: Buffer.alloc(262145), mimetype: 'image/png' },
    { buffer: Buffer.from('fake'), mimetype: 'image/png' },
  ])('rejects active/oversized/fake logos', (file) => {
    expect(() => validateLogo(file)).toThrow('PNG');
  });
  it('blocks cross-issuer logo references and unsupported configuration fields', async () => {
    const h = harness();
    await expect(
      h.service.save(
        'issuer-a',
        { ...input, logoAssetId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
        context,
      ),
    ).rejects.toThrow('does not belong');
    await expect(
      h.service.save('issuer-a', { ...input, secretKey: 'must-not-accept' }, context),
    ).rejects.toThrow('Invalid');
  });
  it('blocks stale profile revision', async () => {
    const h = harness();
    await h.service.save('issuer-a', input, context);
    await expect(h.service.save('issuer-a', input, context)).rejects.toThrow('concurrently');
  });
  it('audits identity/defaults/logo changes without credentials/ciphertexts/binary payloads or network calls', async () => {
    const h = harness();
    const spy = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network forbidden'));
    try {
      await h.service.save('issuer-a', input, context);
      const output = JSON.stringify({
        view: await h.service.get('issuer-a'),
        audit: h.audit.record.mock.calls,
      });
      expect(output).not.toContain('secret-envelope');
      expect(output).not.toContain('Ciphertext');
      expect(spy).not.toHaveBeenCalled();
      expect(h.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ eventKey: 'invoice_branding.profile_saved' }),
        expect.anything(),
      );
    } finally {
      spy.mockRestore();
    }
  });
  it('ADMIN alone manages profiles and logos; accountant reads only', () => {
    for (const method of ['save', 'upload'])
      expect(
        Reflect.getMetadata(
          REQUIRED_ROLES_KEY,
          Object.getOwnPropertyDescriptor(InvoiceBrandingController.prototype, method)!
            .value as object,
        ),
      ).toEqual(['ADMIN']);
    expect(
      Reflect.getMetadata(
        REQUIRED_ROLES_KEY,
        Object.getOwnPropertyDescriptor(InvoiceBrandingController.prototype, 'get')!
          .value as object,
      ),
    ).toEqual(['ADMIN', 'ACCOUNTANT']);
  });
});
