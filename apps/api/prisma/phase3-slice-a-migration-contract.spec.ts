import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Phase 3 Slice A MariaDB migration contract', () => {
  const schema = readFileSync(join(process.cwd(), 'prisma', 'schema.prisma'), 'utf8');
  const migration = readFileSync(
    join(
      process.cwd(),
      'prisma',
      'migrations',
      '20260910000000_phase3_slice_a_communication_domain',
      'migration.sql',
    ),
    'utf8',
  );
  // The file's own prose comments describe (in English) what it deliberately does NOT do — e.g.
  // "no column is dropped or renamed" — which would otherwise false-positive-match a naive
  // DROP/RENAME keyword scan. Strip `--`-comment lines before checking for actual DDL keywords.
  const migrationSqlOnly = migration
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

  it('adds the six approved Phase 3 communication-domain models and the CommunicationOutbox additions', () => {
    expect(schema).toContain('model CommunicationThread');
    expect(schema).toContain('model EmailMessage');
    expect(schema).toContain('model AiClassification');
    expect(schema).toContain('model ClassificationReview');
    expect(schema).toContain('model MailConfiguration');
    expect(schema).toContain('model IntegrationHealthEvent');
    expect(migration).toContain('CREATE TABLE `communication_threads`');
    expect(migration).toContain('CREATE TABLE `email_messages`');
    expect(migration).toContain('CREATE TABLE `ai_classifications`');
    expect(migration).toContain('CREATE TABLE `classification_reviews`');
    expect(migration).toContain('CREATE TABLE `mail_configurations`');
    expect(migration).toContain('CREATE TABLE `integration_health_events`');
    expect(migration).toContain('ADD COLUMN `email_message_id` VARCHAR(36) NULL');
    expect(migration).toContain('ADD COLUMN `message_id_header` VARCHAR(500) NULL');
  });

  it('is purely additive and preserves MariaDB/UUID/JSON/Decimal conventions — no drop, rename, or backfill', () => {
    expect(schema).toContain('provider = "mysql"');
    expect(migrationSqlOnly).not.toMatch(/DROP TABLE|DROP COLUMN|RENAME|TRUNCATE|MODIFY COLUMN/i);
    // No UPDATE/backfill of any kind — the whole migration only creates new objects and adds two
    // nullable columns; there is nothing here that could touch existing row values.
    expect(migrationSqlOnly).not.toMatch(/^\s*UPDATE\s/im);
    expect(migration).toContain('VARCHAR(36)');
    expect(migration).toContain('JSON NOT NULL');
    expect(migration).toContain('DECIMAL(4, 3)');
    expect(migration).toContain('BIGINT NULL');
  });

  it('exact approved AiIntent enum values, and only those, appear on both the AI-classification and correction columns', () => {
    const approved = [
      'ACCEPT_RENEWAL',
      'REJECT_RENEWAL',
      'REQUEST_INVOICE',
      'PAYMENT_REPORTED',
      'REQUEST_UPGRADE',
      'REQUEST_DOWNGRADE',
      'REQUEST_CLARIFICATION',
      'PRICE_DISPUTE',
      'COMPLAINT',
      'OTHER',
      'UNCLEAR',
    ];
    const enumBlockMatch = schema.match(/enum AiIntent \{([^}]+)\}/);
    expect(enumBlockMatch).not.toBeNull();
    const values = (enumBlockMatch?.[1] ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    expect(values).toEqual(approved);

    const intentColumn = migration.match(/`intent` ENUM\(([^)]+)\)/);
    const correctedIntentColumn = migration.match(/`corrected_intent` ENUM\(([^)]+)\)/);
    for (const value of approved) {
      expect(intentColumn?.[1]).toContain(`'${value}'`);
      expect(correctedIntentColumn?.[1]).toContain(`'${value}'`);
    }
  });

  it('never uses ON DELETE CASCADE — every new foreign key is RESTRICT or SET NULL only', () => {
    const foreignKeyLines = migration
      .split('\n')
      .filter((line) => line.includes('ADD CONSTRAINT') && line.includes('FOREIGN KEY'));
    // 13, not 14: classification_reviews has no independent email_message_id FK — see the
    // dedicated referential-integrity test below.
    expect(foreignKeyLines.length).toBe(13);
    for (const line of foreignKeyLines) {
      expect(line).toMatch(/ON DELETE (RESTRICT|SET NULL)/);
      expect(line).not.toMatch(/ON DELETE CASCADE/);
    }
  });

  it('ClassificationReview carries no independent emailMessageId — the only path to a message is through its AiClassification', () => {
    // Schema-level: no such field/relation declaration exists. Checked against actual field/
    // relation lines only (comment lines stripped first) — the model's own explanatory comments
    // legitimately mention "emailMessageId" in prose (describing what was removed and how to query
    // through the relation instead), which would otherwise false-positive-match a naive substring
    // check against the raw model body.
    const reviewModelMatch = schema.match(/model ClassificationReview \{([\s\S]*?)\n\}/);
    expect(reviewModelMatch).not.toBeNull();
    const reviewModelFieldsOnly = (reviewModelMatch?.[1] ?? '')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');
    expect(reviewModelFieldsOnly).not.toMatch(/emailMessageId/);

    // DDL-level: no such column, index, or foreign key exists on classification_reviews.
    const reviewTable = migration.match(
      /CREATE TABLE `classification_reviews` \(([\s\S]*?)\) DEFAULT CHARACTER SET/,
    )?.[1];
    expect(reviewTable).toBeDefined();
    expect(reviewTable).not.toMatch(/email_message_id/);
    // migrationSqlOnly (comment-stripped), not migration: the migration's OWN prose comment
    // deliberately names this exact removed constraint to explain its absence, which would
    // otherwise false-positive-match a naive substring check against the raw file.
    expect(migrationSqlOnly).not.toMatch(/classification_reviews_email_message_id/);

    // The replacement index is scoped by ai_classification_id, not email_message_id.
    expect(migration).toContain(
      'INDEX `classification_reviews_ai_classification_id_created_at_id_idx`(`ai_classification_id`, `created_at`, `id`)',
    );
  });

  it('mail_configurations.billing_entity_id is never SET NULL — a BillingEntity-specific config must never silently become global', () => {
    const line = migration
      .split('\n')
      .find((entry) => entry.includes('mail_configurations_billing_entity_id_fkey'));
    expect(line).toBeDefined();
    expect(line).toContain('ON DELETE RESTRICT');
  });

  it('externalMessageId has no unique constraint — Message-ID is a correlation aid, never the dedup key', () => {
    expect(migration).not.toMatch(/UNIQUE INDEX `email_messages_external_message_id_key`/);
    expect(migration).toContain('INDEX `email_messages_external_message_id_idx`');
  });

  it('imapIdentityKey and renewalCaseId (thread) and emailMessageId (outbox) are all nullable+unique — MariaDB permits multiple NULLs', () => {
    expect(migration).toContain('`imap_identity_key` VARCHAR(191) NULL');
    expect(migration).toContain('UNIQUE INDEX `email_messages_imap_identity_key_key`(`imap_identity_key`)');
    expect(migration).toContain('`renewal_case_id` VARCHAR(36) NULL');
    expect(migration).toContain('UNIQUE INDEX `communication_threads_renewal_case_id_key`(`renewal_case_id`)');
    expect(migration).toContain('ADD COLUMN `email_message_id` VARCHAR(36) NULL');
    expect(migration).toContain(
      'CREATE UNIQUE INDEX `communication_outbox_email_message_id_key` ON `communication_outbox`(`email_message_id`)',
    );
  });

  it('AiClassification carries no reviewedBy/reviewedAt column — corrections are a separate ClassificationReview row', () => {
    const aiClassificationTable = migration.match(
      /CREATE TABLE `ai_classifications` \(([\s\S]*?)\) DEFAULT CHARACTER SET/,
    )?.[1];
    expect(aiClassificationTable).toBeDefined();
    expect(aiClassificationTable).not.toMatch(/reviewed_by|reviewed_at|updated_at/i);
  });

  it('IntegrationHealthEvent carries no resolvedAt/assignedTo/owner/updatedAt column — recovery is a new row, not a mutation', () => {
    const healthEventTable = migration.match(
      /CREATE TABLE `integration_health_events` \(([\s\S]*?)\) DEFAULT CHARACTER SET/,
    )?.[1];
    expect(healthEventTable).toBeDefined();
    expect(healthEventTable).not.toMatch(/resolved_at|assigned_to|owner|updated_at/i);
  });

  it('the frozen imapIdentityKey format ("v1:" + sha256 hex) is documented and its exact length fits VARCHAR(191) with generous headroom', () => {
    // Documentation-consistency check only — this is NOT the Slice C hashing service. It merely
    // proves the frozen contract's own claimed length is correct, using the same primitive
    // (SHA-256 hex digest) the frozen algorithm specifies, so a future change to that algorithm
    // that no longer fits the column is caught here rather than discovered in Slice C.
    expect(schema).toContain('FROZEN IDENTITY CONTRACT');
    expect(schema).toContain('"v1:" + SHA256_hex(canonicalEncoding(tuple))');
    expect(migration).toContain('FROZEN format');

    const exampleTuple = ['abc', 'INBOX', '7', '42'];
    const canonicalEncoding = exampleTuple
      .map((value) => `${Buffer.byteLength(value, 'utf8')}:${value}`)
      .join('');
    const key = `v1:${createHash('sha256').update(canonicalEncoding, 'utf8').digest('hex')}`;

    expect(key).toMatch(/^v1:[0-9a-f]{64}$/);
    expect(key.length).toBe(67);
    expect(key.length).toBeLessThan(191);
  });

  it('the frozen V1 canonicalFolder rule is documented, and behaves correctly: only INBOX is case-normalized, every other name is preserved exactly', () => {
    expect(schema).toContain('FROZEN V1 canonicalFolder RULE');
    expect(schema).toContain('"Sales" and "sales" are, correctly, two distinct canonicalFolder values');

    // Documentation-consistency check only — mirrors the frozen rule locally to prove the rule
    // itself (as stated) produces the intended behavior; this is NOT the Slice C IMAP service.
    function canonicalFolder(persistedName: string): string {
      return persistedName.toUpperCase() === 'INBOX' ? 'INBOX' : persistedName;
    }

    expect(canonicalFolder('inbox')).toBe('INBOX');
    expect(canonicalFolder('INBOX')).toBe('INBOX');
    expect(canonicalFolder('Inbox')).toBe('INBOX');
    // Every other mailbox name is preserved exactly — no lowercasing, no trimming — so two
    // differently-cased non-INBOX names remain two distinct canonicalFolder values.
    expect(canonicalFolder('Sales')).toBe('Sales');
    expect(canonicalFolder('sales')).toBe('sales');
    expect(canonicalFolder('Sales')).not.toBe(canonicalFolder('sales'));
    expect(canonicalFolder(' Sales ')).toBe(' Sales '); // whitespace preserved, not trimmed
  });

  it('freezes the two effective-review-ordering rules distinctly, and never orders by aiClassificationId when finding the latest review for a message', () => {
    expect(schema).toContain('FROZEN EFFECTIVE-REVIEW CONTRACT');
    expect(schema).toContain(
      'aiClassificationId/ai_classification_id must NEVER appear in this ORDER BY',
    );
    expect(migration).toContain('FROZEN EFFECTIVE-REVIEW CONTRACT');
    // The specific wrong phrasing (aiClassificationId used as a literal ORDER BY sort key) must not
    // appear anywhere in either file.
    expect(schema).not.toMatch(/ORDER BY ai_?[Cc]lassificationId,\s*created_?[Aa]t/);
    expect(migrationSqlOnly).not.toMatch(/ORDER BY ai_classification_id,\s*created_at/);
  });

  it('keeps every new MariaDB index and constraint identifier within 64 characters', () => {
    const identifiers = Array.from(
      migration.matchAll(/(?:INDEX|CONSTRAINT)\s+`([^`]+)`/gi),
      (match) => match[1] ?? '',
    );

    expect(identifiers.length).toBeGreaterThan(0);
    expect(identifiers.filter((identifier) => identifier.length > 64)).toEqual([]);
  });
});
