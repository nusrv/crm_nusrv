import type { BullRegistrar } from '@nestjs/bullmq';
import type { PrismaService } from '../database/prisma.service';

/** Confirm the worker's P0 columns are selectable before attaching any BullMQ processors. */
export async function registerP0Workers(
  database: Pick<PrismaService, '$queryRaw'>,
  registrar: Pick<BullRegistrar, 'register'>,
  evidence: { sent?: boolean; review?: boolean } = {},
): Promise<void> {
  try {
    await database.$queryRaw`SELECT purpose, case_revision, recipient_contact_id, resend_of_id, manual_approved_by, smtp_retry_safe, smtp_uncertain, next_attempt_at FROM communication_outbox LIMIT 0`;
    await database.$queryRaw`SELECT resend_of_id, smtp_retry_safe, smtp_uncertain, next_attempt_at FROM operator_reply_outbox LIMIT 0`;
    await database.$queryRaw`SELECT reviewed_at, reviewed_by FROM email_messages LIMIT 0`;
    await database.$queryRaw`SELECT clarification_pending, communication_revision, proposed_period_start, proposed_period_end, proposed_next_renewal_date FROM renewal_cases LIMIT 0`;
  } catch {
    throw new Error('P0 worker schema check failed. Verify database access and the P0 migration chain before starting consumers.');
  }
  try {
    if (evidence.sent) {
      await database.$queryRaw`SELECT mail_configuration_id, generation FROM mail_sent_connection_epochs LIMIT 0`;
      await database.$queryRaw`SELECT connection_generation, folder_identity_key, uid_validity, last_uid FROM mail_evidence_folder_checkpoints LIMIT 0`;
      await database.$queryRaw`SELECT source_identity_key, delivery_status FROM mail_sent_observations LIMIT 0`;
    }
    if (evidence.review) {
      await database.$queryRaw`SELECT identity_key, source_sha256, reason FROM mail_dsn_reviews LIMIT 0`;
    }
  } catch {
    throw new Error('P2 worker schema check failed. Apply verified evidence migrations before enabling evidence workers.');
  }
  registrar.register();
}
