import { z } from 'zod';

const duration = z.string().regex(/^\d+(s|m|h|d)$/);
const ianaTimezone = z.string().refine((timezone) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
}, 'must be a valid IANA timezone');
const base64Key = z.string().refine((value) => {
  try {
    return Buffer.from(value, 'base64').length === 32;
  } catch {
    return false;
  }
}, 'must be a base64-encoded 32-byte value');

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().int().positive().default(3001),
    APP_URL: z.url(),
    WEB_URL: z.url(),
    API_URL: z.url(),
    DATABASE_URL: z.string().startsWith('mysql://'),
    REDIS_URL: z
      .union([
        z.literal(''),
        z.url().refine((value) => ['redis:', 'rediss:'].includes(new URL(value).protocol)),
      ])
      .optional(),
    REDIS_HOST: z.string().min(1).optional(),
    REDIS_PORT: z.coerce.number().int().positive().max(65535).default(6379),
    REDIS_USERNAME: z.string().optional(),
    REDIS_PASSWORD: z.string().optional(),
    REDIS_DB: z.coerce.number().int().min(0).default(0),
    REDIS_TLS: z.enum(['true', 'false']).default('false'),
    BUSINESS_TIMEZONE: ianaTimezone.default('Asia/Amman'),
    JWT_ACCESS_SECRET: z.string().min(32),
    JWT_REFRESH_SECRET: z.string().min(32),
    JWT_ACCESS_TTL: duration.default('15m'),
    JWT_REFRESH_TTL: duration.default('7d'),
    ENCRYPTION_KEY_BASE64: base64Key,
    CAPTCHA_PROVIDER: z.enum(['none', 'mock', 'turnstile', 'recaptcha']).default('mock'),
    CAPTCHA_TEST_TOKEN: z.string().min(8).optional(),
    CAPTCHA_SITE_KEY: z.string().optional(),
    CAPTCHA_SECRET: z.string().optional(),
    // Phase 3.1 §J correction — DEPRECATED / PARSED-ONLY. AiSettingsResolverService (the persisted
    // `ai_settings` DB row) is the sole runtime authority for whether AI is enabled and which
    // provider/model/key it uses. None of AI_ENABLED/AI_PROVIDER/AI_MODEL/AI_API_KEY/
    // AI_CONFIDENCE_THRESHOLD is read anywhere in the classification/routing/drafting pipeline any
    // more — DynamicLlmGateway (llm-provider.module.ts) resolves the real provider adapter
    // (OpenAI/Anthropic/Google Gemini, via LlmProviderRegistry) dynamically from AiSettings, or
    // fails closed (HUMAN_REVIEW), never from these env vars. Kept
    // declared only so an existing `.env` file that still sets them does not fail to parse; no
    // cross-field validation is applied to them any more (see PHASES/PHASE_03_1_ADMIN_SETTINGS.md's
    // env-status table for the complete list).
    AI_ENABLED: z.enum(['true', 'false']).default('false'),
    AI_PROVIDER: z.enum(['mock', 'openai']).default('mock'),
    AI_MODEL: z.string().optional(),
    AI_API_KEY: z.string().optional(),
    AI_CONFIDENCE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.9),
    // Phase 3 Slice G — DEPRECATED. This combined switch never performed any business action in any
    // shipped slice (Slice D never read it). It is kept ONLY as a config-detection field so a
    // deployment still setting it to 'true' fails validation with a clear message instead of being
    // silently ignored or silently aliased to the new switch below — see the superRefine rule.
    AI_AUTO_ROUTE_ACCEPT_REJECT: z.enum(['true', 'false']).default('false'),
    // Phase 3.1 §J correction — DEPRECATED / PARSED-ONLY, same reasoning as AI_ENABLED above.
    // AiSettings.autoRouteAccept/autoRouteAcceptCutoverAt (read via AiSettingsResolverService) are
    // the sole runtime authority. Neither of these env vars is read anywhere any more.
    AI_AUTO_ROUTE_ACCEPT: z.enum(['true', 'false']).default('false'),
    AI_AUTO_ROUTE_ACCEPT_CUTOVER_AT: z.string().optional(),
    FAWTARA_MODE: z.enum(['mock', 'sandbox', 'production']).default('mock'),
    // Phase 3.1 §D/§Q correction — the ONE retained infrastructure-capability concept for mail:
    // which adapter class (mock vs. a real network-capable transport) this deployment is even
    // wired to use at process boot (see worker-app.module.ts's MAIL_TRANSPORT/MAILBOX_READER_FACTORY
    // factories) — never a routine, admin-managed operational setting. A production deployment must
    // never run with a mock adapter, full stop, regardless of MailConfiguration's own DB state (see
    // the unconditional production+mock rule below) — this is the one deliberate exception to
    // "operational DB state is authoritative," analogous to FAWTARA_MODE/PLESK_MODE/SMARTERMAIL_MODE.
    // Its EFFECTIVE state is surfaced read-only in Settings/Integration Health
    // (IntegrationHealthService), so the UI can never claim "Ready" while this deployment is still
    // wired to a mock adapter.
    SMTP_MODE: z.enum(['mock', 'sandbox', 'production']).default('mock'),
    PLESK_MODE: z.enum(['mock', 'sandbox', 'production']).default('mock'),
    SMARTERMAIL_MODE: z.enum(['mock', 'sandbox', 'production']).default('mock'),
    // Phase 3.1 §D/§Q correction — DEPRECATED / PARSED-ONLY. Real per-mailbox operational control
    // (whether THIS mailbox actually sends) is exclusively MailConfiguration.outboundSendEnabled/
    // outboundSendCutoverAt (read via MailConfigurationResolverService, fresh on every attempt).
    // Neither of these env vars is read anywhere in MailOutboundService/OperatorReplyOutboundService
    // any more — kept declared only for backward-compatible `.env` parsing.
    MAIL_SEND_ENABLED: z.enum(['true', 'false']).default('false'),
    MAIL_SEND_CUTOVER_AT: z.string().optional(),
    // See SMTP_MODE's doc comment — the identical infrastructure-capability concept for IMAP.
    IMAP_MODE: z.enum(['mock', 'real']).default('mock'),
    // Phase 3.1 §D/§Q correction — DEPRECATED / PARSED-ONLY, same reasoning as MAIL_SEND_ENABLED.
    // MailConfiguration.inboundSyncEnabled is the sole per-mailbox runtime authority.
    IMAP_SYNC_ENABLED: z.enum(['true', 'false']).default('false'),
  })
  .superRefine((value, context) => {
    if (!value.REDIS_URL && !value.REDIS_HOST) {
      context.addIssue({
        code: 'custom',
        path: ['REDIS_HOST'],
        message: 'REDIS_URL or REDIS_HOST is required',
      });
    }
    if (value.NODE_ENV === 'production' && value.CAPTCHA_PROVIDER === 'mock') {
      context.addIssue({
        code: 'custom',
        path: ['CAPTCHA_PROVIDER'],
        message: 'mock CAPTCHA is forbidden in production',
      });
    }
    if (value.CAPTCHA_PROVIDER === 'mock' && !value.CAPTCHA_TEST_TOKEN) {
      context.addIssue({
        code: 'custom',
        path: ['CAPTCHA_TEST_TOKEN'],
        message: 'is required for mock CAPTCHA',
      });
    }
    if (
      ['turnstile', 'recaptcha'].includes(value.CAPTCHA_PROVIDER) &&
      (!value.CAPTCHA_SITE_KEY || !value.CAPTCHA_SECRET)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['CAPTCHA_SECRET'],
        message: 'CAPTCHA site key and secret are required for a production provider',
      });
    }
    // Phase 3.1 §D/§Q correction — UNCONDITIONAL now (previously gated on the now-non-authoritative
    // MAIL_SEND_ENABLED): a production deployment must never be wired to a mock SMTP adapter, full
    // stop, regardless of any MailConfiguration's own DB state — the infrastructure-capability
    // boundary must hold even if every mailbox's outboundSendEnabled happens to be true.
    if (value.NODE_ENV === 'production' && value.SMTP_MODE === 'mock') {
      context.addIssue({
        code: 'custom',
        path: ['SMTP_MODE'],
        message:
          'SMTP_MODE=mock is forbidden in production — a production runtime must never be capable of marking customer messages DELIVERED through a mock transport, regardless of any MailConfiguration.outboundSendEnabled state',
      });
    }
    // Phase 3.1 §D/§Q correction — same unconditional rule for IMAP.
    if (value.NODE_ENV === 'production' && value.IMAP_MODE === 'mock') {
      context.addIssue({
        code: 'custom',
        path: ['IMAP_MODE'],
        message:
          'IMAP_MODE=mock is forbidden in production — a production runtime must never be capable of appearing to sync mail through a fake mailbox reader, regardless of any MailConfiguration.inboundSyncEnabled state',
      });
    }
    // Phase 3 Slice G — the deprecated combined switch must never silently activate routing, and
    // must never be silently aliased to the new switch either (it previously performed no business
    // action, so treating it as equivalent to AI_AUTO_ROUTE_ACCEPT=true would be a behavior change
    // no deployment ever opted into). Fail closed with an explicit message instead. (Unrelated to
    // the Phase 3.1 §J correction above — this field never had any runtime authority to remove.)
    if (value.AI_AUTO_ROUTE_ACCEPT_REJECT === 'true') {
      context.addIssue({
        code: 'custom',
        path: ['AI_AUTO_ROUTE_ACCEPT_REJECT'],
        message:
          'AI_AUTO_ROUTE_ACCEPT_REJECT is deprecated and performs no business action in this version — remove it; automatic acceptance routing is now controlled exclusively by AiSettings.autoRouteAccept in Settings',
      });
    }
  });

export type Environment = z.infer<typeof environmentSchema>;

export function validateEnvironment(input: Record<string, unknown>): Environment {
  const result = environmentSchema.safeParse(input);
  if (!result.success) {
    throw new Error(`Invalid environment configuration: ${z.prettifyError(result.error)}`);
  }
  return result.data;
}
