import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Phase 4A invoice foundation contracts', () => {
  const webComponent = (name: string) =>
    readFileSync(join(process.cwd(), '..', 'web', 'components', name), 'utf8');
  const migration = readFileSync(
    join(
      process.cwd(),
      'prisma',
      'migrations',
      '20261117000000_phase4a_manual_invoice_foundation',
      'migration.sql',
    ),
    'utf8',
  );
  const service = readFileSync(
    join(process.cwd(), 'src', 'modules', 'invoices', 'invoices.service.ts'),
    'utf8',
  );
  const boundary = readFileSync(
    join(process.cwd(), 'src', 'modules', 'invoices', 'fawtara-boundary.ts'),
    'utf8',
  );

  it('uses RESTRICT for every source financial-record relation and has no Invoice delete endpoint', () => {
    expect(migration).toMatch(/invoices_customer_fkey[\s\S]*ON DELETE RESTRICT/);
    expect(migration).toMatch(/invoices_source_subscription_fkey[\s\S]*ON DELETE RESTRICT/);
    expect(migration).toMatch(/invoice_lines_source_subscription_fkey[\s\S]*ON DELETE RESTRICT/);
    const controller = readFileSync(
      join(process.cwd(), 'src', 'modules', 'invoices', 'invoices.controller.ts'),
      'utf8',
    );
    expect(controller).not.toContain('@Delete');
  });

  it('contains database duplicate guards without making sourceSubscriptionId globally unique', () => {
    expect(migration).toContain('invoices_active_draft_key_key');
    expect(migration).toContain('invoices_subscription_period_idx');
    expect(migration).not.toMatch(/UNIQUE INDEX[^\n]*\(`source_subscription_id`\)/);
    expect(migration).toContain('invoices_entity_fawtara_number_key');
    expect(migration).toContain('invoices_fawtara_uuid_key');
  });

  it('has an adapter boundary but no JoFotara network request in this phase', () => {
    expect(boundary).toContain('interface FawtaraInvoiceMapper');
    expect(boundary).toContain('interface FawtaraGateway');
    expect(boundary).toContain('interface FawtaraSubmissionResult');
    expect(`${service}\n${boundary}`).not.toMatch(/fetch\(|axios|backend\.jofotara\.gov\.jo/);
  });

  it('renders drafts as non-official and accepted official identity/QR from recorded values', () => {
    const renderer = webComponent('invoice-renderer.tsx');
    expect(renderer).toContain('DRAFT / NOT OFFICIAL');
    expect(renderer).toContain('invoice.fawtaraInvoiceNumber');
    expect(renderer).toContain('invoice.fawtaraInvoiceUuid');
    expect(renderer).toContain('src={invoice.fawtaraQrImageDataUrl}');
    expect(renderer).toContain('invoice.effectiveGrandTotal');
    expect(renderer).not.toMatch(/QRCode|generateQr|toDataURL/);
  });

  it('exposes the complete operator flow from ACTIVE subscription through manual result recording', () => {
    const subscriptionModal = webComponent('subscription-modal.tsx');
    const detail = webComponent('invoice-detail.tsx');
    expect(subscriptionModal).toContain("editing?.status === 'ACTIVE'");
    expect(subscriptionModal).toContain('Create Invoice');
    expect(detail).toContain('Validate / Preflight');
    expect(detail).toContain('Mark Ready for JoFotara');
    // P1 owner policy requires an explicit, separately labeled officialization
    // action — recording draft data or marking READY must not be mistaken for it.
    expect(detail).toContain('Officialize Invoice');
    expect(detail).toContain('/officialize');
    expect(detail).toContain('Print / Save PDF');
  });
});
