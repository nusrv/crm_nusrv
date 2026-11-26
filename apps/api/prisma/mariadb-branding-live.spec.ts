import { officialQrImage } from '../src/modules/invoices/official-qr';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import mariadb, { type Connection } from 'mariadb';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../src/generated/prisma/client';
import { toMariaDbDriverUrl } from '../src/database/mariadb-url';
import { readAllMigrationsSql } from './read-all-migrations';
import { AuditService } from '../src/audit/audit.service';
import { InvoiceBrandingService } from '../src/modules/invoice-branding/invoice-branding.service';
import { InvoicesService } from '../src/modules/invoices/invoices.service';
import { InvoicePreflightService } from '../src/modules/invoices/invoice-preflight.service';
import { ClockService } from '../src/time/clock.service';
import { BusinessTimeService } from '../src/time/business-time.service';
import { ConfigService } from '@nestjs/config';
import { defaultInvoiceVisibility } from '@cp/shared';
const url = process.env.MARIADB_BRANDING_TEST_DATABASE_URL;
const live = url ? describe : describe.skip;
live('Multi-issuer branding on disposable MariaDB', () => {
  let db: Connection,
    prisma: PrismaClient,
    branding: InvoiceBrandingService,
    invoices: InvoicesService;
  let issuer: string,
    otherIssuer: string,
    subscriptionId: string,
    actorId: string,
    invoiceId: string,
    firstLogo: string;
  const png = readFileSync(join(process.cwd(), '../web/public/nusrv-invoice-logo.png'));
  const futurePng = readFileSync(
    join(process.cwd(), '../web/public/invoice-branding-presets/future-foresight-logo.png'),
  );
  beforeAll(async () => {
    const u = new URL(url!);
    const name = u.pathname.slice(1);
    if (!['127.0.0.1', 'localhost'].includes(u.hostname) || !name.endsWith('_test'))
      throw new Error('Disposable loopback *_test DB required.');
    db = await mariadb.createConnection({
      host: u.hostname,
      port: Number(u.port) || 3306,
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: name,
      multipleStatements: true,
    });
    // The isolated launcher preflights a new schema; never erase an existing
    // database if this fixture is invoked directly.
    const [row] = await db.query<Array<{ db_name: string; table_count: bigint | number }>>(
      'SELECT DATABASE() AS db_name, (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()) AS table_count',
    );
    if (row?.db_name !== name || Number(row.table_count) !== 0) {
      throw new Error('Expected a freshly provisioned empty disposable schema.');
    }
    await db.query(readAllMigrationsSql());
    prisma = new PrismaClient({ adapter: new PrismaMariaDb(toMariaDbDriverUrl(url!)) });
    const a = await prisma.billingEntity.create({
      data: {
        code: 'PERSONAL_TEST',
        customerCodePrefix: 'PT',
        name: 'Person',
        legalName: 'Personal Legal Name',
        issuerType: 'INDIVIDUAL',
        paymentScope: 'LOCAL',
        countryCode: 'JO',
        address: 'Seller Address',
        taxNumber: '12345678',
        invoiceEmail: 'person@example.test',
      },
    });
    issuer = a.id;
    otherIssuer = (
      await prisma.billingEntity.create({
        data: {
          code: 'OTHER_TEST',
          customerCodePrefix: 'OT',
          name: 'Other',
          legalName: 'Other Legal Issuer',
          paymentScope: 'INTERNATIONAL',
        },
      })
    ).id;
    actorId = (
      await prisma.user.create({
        data: {
          email: 'branding-admin@example.test',
          displayName: 'Admin',
          passwordHash: 'not-a-password',
        },
      })
    ).id;
    const customer = await prisma.customer.create({
      data: {
        billingEntityId: issuer,
        customerCode: 'PT0001',
        nameEn: 'Buyer',
        primaryEmail: 'buyer@example.test',
        address: 'Buyer Address',
        country: 'JO',
      },
    });
    const service = await prisma.serviceType.create({
      data: { code: 'BRANDING_TEST', name: 'Hosting' },
    });
    subscriptionId = (
      await prisma.subscription.create({
        data: {
          customerId: customer.id,
          serviceTypeId: service.id,
          subscriptionCode: 'PT0001-S01',
          name: 'Hosting',
          startDate: new Date('2026-01-01'),
          renewalDate: new Date('2027-01-01'),
          billingFrequency: 'ANNUAL',
          sellingPrice: '100.000',
          currency: 'JOD',
          status: 'ACTIVE',
        },
      })
    ).id;
    const audit = new AuditService(prisma as never);
    branding = new InvoiceBrandingService(prisma as never, audit);
    invoices = new InvoicesService(
      prisma as never,
      audit,
      new ClockService(),
      new BusinessTimeService(new ConfigService({ BUSINESS_TIMEZONE: 'Asia/Amman' })),
      new InvoicePreflightService(),
    );
  }, 120_000);
  afterAll(async () => {
    try {
      await prisma?.$disconnect();
    } finally {
      await db?.end();
    }
  });
  it('retains defaults and logo version at creation; later profile edits do not alter the invoice', async () => {
    firstLogo = (
      await branding.uploadLogo(issuer, { buffer: png, mimetype: 'image/png' }, { actorId })
    ).id;
    const initial = await branding.get(issuer);
    const {
      billingEntityId: unusedId,
      code: unusedCode,
      logoDataUrl: unusedLogo,
      ...input
    } = initial;
    void unusedId;
    void unusedCode;
    void unusedLogo;
    await branding.save(
      issuer,
      { ...input, details: { phone: 'OLD-PHONE', jodIban: 'OLD-BANK' }, logoAssetId: firstLogo },
      { actorId },
    );
    const invoice = await invoices.createFromSubscription(subscriptionId, { actorId });
    invoiceId = invoice.id;
    expect(invoice.issuerLogoAssetId).toBe(firstLogo);
    expect(invoice.issuerPresentationSnapshot).toMatchObject({
      issuerType: 'INDIVIDUAL',
      details: { phone: 'OLD-PHONE' },
    });
    const latest = await branding.get(issuer);
    const { billingEntityId: a, code: b, logoDataUrl: c, ...newInput } = latest;
    void a;
    void b;
    void c;
    await branding.save(
      issuer,
      {
        ...newInput,
        legalName: 'New Personal Legal Name',
        details: { phone: 'NEW-PHONE', jodIban: 'NEW-BANK' },
        logoAssetId: null,
        visibility: { ...latest.visibility, logo: false },
      },
      { actorId },
    );
    const historic = await invoices.findOne(invoiceId);
    expect(historic.issuerLegalNameSnapshot).toBe('Personal Legal Name');
    expect(historic.issuerLogoAssetId).toBe(firstLogo);
    expect(historic.issuerLogoDataUrl).toBe('data:image/png;base64,' + png.toString('base64'));
    expect(historic.issuerPresentationSnapshot).toMatchObject({ details: { phone: 'OLD-PHONE' } });
  });
  it('draft visibility overrides leave master defaults and legal tax snapshots untouched, with audit', async () => {
    const before = await branding.get(issuer);
    const beforeLines = await prisma.invoiceLine.findMany({
      where: { invoiceId },
      orderBy: { position: 'asc' },
    });
    await invoices.updateDraft(
      invoiceId,
      {
        presentationVisibility: {
          ...defaultInvoiceVisibility(),
          phone: false,
          jodBank: false,
          taxNumber: false,
        },
      },
      { actorId },
    );
    const invoice = await invoices.findOne(invoiceId);
    expect(invoice.issuerTaxNumberSnapshot).toBe('12345678');
    expect(invoice.issuerPresentationSnapshot).toMatchObject({
      visibility: { phone: false, jodBank: false, taxNumber: false },
    });
    expect((await branding.get(issuer)).visibility).toEqual(before.visibility);
    expect(
      await prisma.invoiceLine.findMany({ where: { invoiceId }, orderBy: { position: 'asc' } }),
    ).toEqual(beforeLines);
    const event = await prisma.auditEvent.findFirst({
      where: { eventKey: 'invoice.presentation_overridden', subjectId: invoiceId },
      orderBy: { createdAt: 'desc' },
    });
    expect(event?.newState).toMatchObject({
      issuerPresentation: { visibility: { jodBank: false } },
    });
  });
  it('blocks cross-issuer assets, retains logo rows and prohibits accepted presentation edits', async () => {
    const foreign = (
      await branding.uploadLogo(
        otherIssuer,
        { buffer: futurePng, mimetype: 'image/png' },
        { actorId },
      )
    ).id;
    const current = await branding.get(issuer);
    const { billingEntityId: a, code: b, logoDataUrl: c, ...input } = current;
    void a;
    void b;
    void c;
    await expect(
      branding.save(issuer, { ...input, logoAssetId: foreign }, { actorId }),
    ).rejects.toThrow('does not belong');
    await expect(
      prisma.invoiceBrandingAsset.delete({ where: { id: firstLogo } }),
    ).rejects.toThrow();
    await prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        status: 'FAWTARA_ACCEPTED',
        fawtaraStatus: 'SUBMITTED',
        fawtaraInvoiceNumber: 'OFFICIAL-FIXTURE',
        fawtaraQrImageDataUrl: await officialQrImage('OFFICIAL-RESPONSE-FIXTURE'),
        fawtaraAcceptedAt: new Date(),
      },
    });
    await expect(
      invoices.updateDraft(
        invoiceId,
        { presentationVisibility: defaultInvoiceVisibility() },
        { actorId },
      ),
    ).rejects.toThrow('Only a DRAFT');
    await prisma.billingEntity.update({ where: { id: issuer }, data: { active: false } });
    const historical = await invoices.findOne(invoiceId);
    expect(historical.issuerLogoDataUrl).toContain(png.toString('base64'));
    expect(historical.finalPrintEnabled).toBe(true);
  });
  it('does not invent Future tax numbers or alter credentials when managing branding', async () => {
    const e = await prisma.billingEntity.findUniqueOrThrow({ where: { id: otherIssuer } });
    expect(e.taxNumber).toBeNull();
    expect(await prisma.joFotaraConnection.count()).toBe(0);
    const events = await prisma.auditEvent.findMany({ where: { subjectType: 'BillingEntity' } });
    expect(JSON.stringify(events)).not.toContain('Ciphertext');
  });
});
