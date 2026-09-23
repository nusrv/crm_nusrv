import type { ConfigService } from '@nestjs/config';

export type MailAdapterCapability = 'REAL' | 'MOCK';

/**
 * Phase 3.1 §2C correction — the ONE place that decides whether this deployment is even capable of
 * real SMTP/IMAP. Read by BOTH the worker's actual MAIL_TRANSPORT/MAILBOX_READER_FACTORY DI
 * selection (worker-app.module.ts) and the CRM's read-only effective-status reporting
 * (MailSettingsService), so the two can never disagree with each other — a Settings page can never
 * say "Ready" while the worker silently uses a mock adapter, or vice versa.
 *
 * SMTP_MODE/IMAP_MODE are the ONE retained infrastructure-capability concept (see environment.ts).
 * MAIL_SEND_ENABLED/IMAP_SYNC_ENABLED are deprecated/parsed-only and must NEVER influence this
 * decision — that duplicate, hidden authority is exactly the class of bug this correction pass
 * removes (see DynamicLlmGateway for the identical fix on the AI side).
 */
export function resolveSmtpAdapterCapability(config: Pick<ConfigService, 'get'>): MailAdapterCapability {
  return config.get<string>('SMTP_MODE') === 'mock' ? 'MOCK' : 'REAL';
}

export function resolveImapAdapterCapability(config: Pick<ConfigService, 'get'>): MailAdapterCapability {
  return config.get<string>('IMAP_MODE') === 'mock' ? 'MOCK' : 'REAL';
}
