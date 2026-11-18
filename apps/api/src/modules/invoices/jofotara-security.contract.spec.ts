import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { REQUIRED_ROLES_KEY } from '../../identity/auth.constants';
import { JoFotaraConnectionsController } from './jofotara-connections.controller';
import { InvoicesController } from './invoices.controller';
describe('JoFotara security/retention contracts', () => {
  it('configuration is ADMIN-only; accountant GET is safe read-only', () => {
    expect(
      Reflect.getMetadata(
        REQUIRED_ROLES_KEY,
        Object.getOwnPropertyDescriptor(JoFotaraConnectionsController.prototype, 'create')!
          .value as object,
      ),
    ).toEqual(['ADMIN']);
    expect(
      Reflect.getMetadata(
        REQUIRED_ROLES_KEY,
        Object.getOwnPropertyDescriptor(JoFotaraConnectionsController.prototype, 'update')!
          .value as object,
      ),
    ).toEqual(['ADMIN']);
    expect(
      Reflect.getMetadata(
        REQUIRED_ROLES_KEY,
        Object.getOwnPropertyDescriptor(JoFotaraConnectionsController.prototype, 'list')!
          .value as object,
      ),
    ).toEqual(['ADMIN', 'ACCOUNTANT']);
    expect(Reflect.getMetadata(REQUIRED_ROLES_KEY, InvoicesController)).toEqual([
      'ADMIN',
      'ACCOUNTANT',
    ]);
  });
  it('AI, queue, cron and mail code has no submission service/gateway path', () => {
    function scan(dir: string): string {
      return readdirSync(dir, { withFileTypes: true })
        .map((e) =>
          e.isDirectory()
            ? scan(join(dir, e.name))
            : e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts')
              ? readFileSync(join(dir, e.name), 'utf8')
              : '',
        )
        .join('\n');
    }
    for (const name of ['ai', 'mail', 'communications', 'renewal-cases'])
      expect(scan(join(process.cwd(), 'src/modules', name))).not.toMatch(
        /FawtaraSubmissionService|JoFotaraGateway|submit-official|backend\.jofotara/,
      );
    expect(readFileSync(join(process.cwd(), 'src/worker-app.module.ts'), 'utf8')).not.toContain(
      'InvoicesModule',
    );
  });
  it('migration uses safe backfill, default constraint, and RESTRICT for all history', () => {
    const sql = readFileSync(
      join(
        process.cwd(),
        'prisma/migrations/20261118010000_phase4b_jofotara_connections_submissions/migration.sql',
      ),
      'utf8',
    );
    expect(sql).toContain('UPDATE invoices SET submission_uuid = UUID()');
    expect(sql).toContain('jofotara_active_default_check');
    expect(sql).toContain('production_submission_enabled` BOOLEAN NOT NULL DEFAULT false');
    expect(sql).not.toMatch(/ON DELETE CASCADE|DROP TABLE.*invoices/i);
    expect(sql.match(/ON DELETE RESTRICT/g)).toHaveLength(4);
  });
});
