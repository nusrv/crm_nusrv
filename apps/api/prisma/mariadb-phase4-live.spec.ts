import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import mariadb, { type Connection } from 'mariadb';
const url = process.env.MARIADB_PHASE4_TEST_DATABASE_URL;
const live = url ? describe : describe.skip;
live('Phase 4 additive migration on populated disposable MariaDB', () => {
  let db: Connection;
  beforeAll(async () => {
    const u = new URL(url!);
    const name = u.pathname.slice(1);
    if (!['localhost', '127.0.0.1'].includes(u.hostname) || !name.endsWith('_test'))
      throw new Error('Loopback disposable *_test database required.');
    db = await mariadb.createConnection({
      host: u.hostname,
      port: Number(u.port) || 3306,
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: name,
      multipleStatements: true,
    });
    await db.query('SET FOREIGN_KEY_CHECKS=0');
    const tables = await db.query<Array<{ TABLE_NAME: string }>>(
      'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()',
    );
    for (const t of tables) {
      if (!/^[a-z0-9_]+$/.test(t.TABLE_NAME)) throw new Error('Unsafe table.');
      await db.query('DROP TABLE `' + t.TABLE_NAME + '`');
    }
    await db.query('SET FOREIGN_KEY_CHECKS=1');
    const dir = join(process.cwd(), 'prisma/migrations');
    const dirs = readdirSync(dir)
      .filter((n) => statSync(join(dir, n)).isDirectory())
      .sort();
    for (const n of dirs.filter((n) => n < '20261118000000'))
      await db.query(readFileSync(join(dir, n, 'migration.sql'), 'utf8'));
    await db.query(`INSERT INTO billing_entities(id,name,code,customer_code_prefix,payment_scope,legal_name,updated_at) VALUES ('entity-a','Issuer A','TESTA','TA','LOCAL','Issuer A',NOW()),('entity-b','Issuer B','TESTB','TB','LOCAL','Issuer B',NOW());
  INSERT INTO customers(id,billing_entity_id,customer_code,name_en,primary_email,updated_at) VALUES('customer-a','entity-a','TA0001','Buyer','buyer@example.test',NOW());
  INSERT INTO service_types(id,code,name,updated_at) VALUES('service-a','HOSTTEST','Hosting',NOW());
  INSERT IGNORE INTO currencies(code,name,active,updated_at) VALUES('JOD','Jordanian Dinar',true,NOW());
  INSERT INTO subscriptions(id,customer_id,service_type_id,subscription_code,name,start_date,renewal_date,billing_frequency,selling_price,currency,updated_at) VALUES('subscription-a','customer-a','service-a','TA0001-S01','Hosting','2026-01-01','2027-01-01','ANNUAL',100,'JOD',NOW());
  INSERT INTO invoices(id,customer_id,billing_entity_id,source_subscription_id,status,internal_reference,invoice_date,currency_code,period_start,period_end,customer_code_snapshot,issuer_code_snapshot,issuer_legal_name_snapshot,grand_total,official_grand_total,updated_at) VALUES('invoice-old','customer-a','entity-a','subscription-a','FAWTARA_ACCEPTED','OLD-1','2026-01-01','JOD','2026-01-01','2027-01-01','TA0001','TA','Issuer A',100,110,NOW());`);
    for (const n of dirs.filter((n) => n >= '20261118000000'))
      await db.query(readFileSync(join(dir, n, 'migration.sql'), 'utf8'));
  }, 60000);
  afterAll(async () => {
    await db?.end();
  });
  it('retains populated financial records and backfills UUID, counter and manual provenance', async () => {
    const rows = await db.query<
      Array<{
        submission_uuid: string;
        invoice_counter: bigint;
        officialization_provenance: string;
        reconciliation_required: number;
        grand_total: number;
      }>
    >('SELECT * FROM invoices WHERE id=?', ['invoice-old']);
    const i = rows[0]!;
    expect(i.submission_uuid).toMatch(/^[a-f0-9-]{36}$/);
    expect(i.invoice_counter).toBe(1n);
    expect(i.officialization_provenance).toBe('MANUAL');
    expect(i.reconciliation_required).toBe(1);
    expect(String(i.grand_total)).toBe('100.000');
    const counters = await db.query<Array<{ last_invoice_counter: bigint }>>(
      'SELECT last_invoice_counter FROM billing_entities WHERE id=?',
      ['entity-a'],
    );
    expect(counters[0]!.last_invoice_counter).toBe(1n);
  });
  it('supports independent devices, production OFF and one active issuer default', async () => {
    await db.query(
      `INSERT INTO jofotara_connections(id,billing_entity_id,display_name,income_source_sequence,default_entity_key,updated_at) VALUES('conn-a','entity-a','Device A','123','entity-a',NOW()),('conn-b','entity-a','Device B','456',NULL,NOW())`,
    );
    const rows = await db.query<Array<{ production_submission_enabled: number }>>(
      'SELECT production_submission_enabled FROM jofotara_connections',
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.production_submission_enabled === 0)).toBe(true);
    await expect(
      db.query("UPDATE jofotara_connections SET default_entity_key='entity-a' WHERE id='conn-b'"),
    ).rejects.toThrow();
    await expect(
      db.query("UPDATE jofotara_connections SET enabled=false WHERE id='conn-a'"),
    ).rejects.toThrow();
    await expect(
      db.query("UPDATE jofotara_connections SET default_entity_key='entity-b' WHERE id='conn-b'"),
    ).rejects.toThrow();
  });
  it('retains submission history and prohibits deleting its invoice/device', async () => {
    await db.query(
      `INSERT INTO fawtara_submissions(id,invoice_id,jofotara_connection_id,attempt_number,business_id,business_uuid,request_xml_hash,request_xml,connection_name_snapshot,income_source_snapshot,outcome,actor_id) VALUES('attempt-a','invoice-old','conn-b',1,'OLD-1','test-uuid',REPEAT('a',64),'<Invoice/>','Device B','456','ACCEPTED','admin')`,
    );
    await expect(db.query("DELETE FROM jofotara_connections WHERE id='conn-b'")).rejects.toThrow();
    await expect(db.query("DELETE FROM invoices WHERE id='invoice-old'")).rejects.toThrow();
    await db.query(
      "UPDATE jofotara_connections SET enabled=false,disabled_at=NOW() WHERE id='conn-b'",
    );
    const rows = await db.query<Array<{ connection_name_snapshot: string }>>(
      'SELECT connection_name_snapshot FROM fawtara_submissions',
    );
    expect(rows[0]!.connection_name_snapshot).toBe('Device B');
  });
  it('releases only the cancelled draft duplicate key and enforces revision compare-and-set', async () => {
    const create = (id: string) =>
      db.query(
        `INSERT INTO invoices(id,customer_id,billing_entity_id,source_subscription_id,status,internal_reference,active_draft_key,invoice_date,currency_code,period_start,period_end,customer_code_snapshot,issuer_code_snapshot,issuer_legal_name_snapshot,submission_uuid,updated_at)
   SELECT ?,customer_id,billing_entity_id,source_subscription_id,'DRAFT',?,'same-service-period',invoice_date,currency_code,period_start,period_end,customer_code_snapshot,issuer_code_snapshot,issuer_legal_name_snapshot,UUID(),NOW() FROM invoices WHERE id='invoice-old'`,
        [id, id],
      );
    await create('draft-one');
    await expect(create('draft-two')).rejects.toThrow();
    await db.query(
      "UPDATE invoices SET status='CANCELLED',active_draft_key=NULL,cancellation_reason='Mistake',cancelled_by='admin',cancelled_at=NOW() WHERE id='draft-one' AND status='DRAFT'",
    );
    await create('draft-two');
    const first = await db.query<{ affectedRows: number }>(
      "UPDATE invoices SET revision=revision+1 WHERE id='draft-two' AND revision=0",
    );
    const stale = await db.query<{ affectedRows: number }>(
      "UPDATE invoices SET revision=revision+1 WHERE id='draft-two' AND revision=0",
    );
    expect(first.affectedRows).toBe(1);
    expect(stale.affectedRows).toBe(0);
  });
});
