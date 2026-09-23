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
    // Phase 3 Slice D — AI classification master switch, off by default. AI_PROVIDER follows the
    // same mock/real shape as SMTP_MODE/IMAP_MODE ('mock' never makes a network call; 'openai' is
    // the one real provider identified in 05_AI_LLM_MCP_STRATEGY.md). The fail-closed rule below
    // (production + enabled + mock) mirrors MAIL_SEND_ENABLED/SMTP_MODE's own rule.
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
    // Phase 3 Slice G — the one real automatic-business-action switch: high-confidence
    // ACCEPT_RENEWAL -> RenewalCase ACCEPTED. Off by default. Requires AI_ENABLED=true and a valid
    // AI_AUTO_ROUTE_ACCEPT_CUTOVER_AT whenever enabled (validated below) — the exact
    // MAIL_SEND_ENABLED/MAIL_SEND_CUTOVER_AT precedent, fail-closed. There is deliberately no
    // AI_AUTO_ROUTE_REJECT yet — no safe automatic rejection routing exists in this slice.
    AI_AUTO_ROUTE_ACCEPT: z.enum(['true', 'false']).default('false'),
    // Required, ISO-8601, whenever AI_AUTO_ROUTE_ACCEPT=true. AiRoutingService only ever considers
    // an AiClassification eligible for AUTO_ACCEPT if it was created at or after this instant —
    // historical classifications created before this boundary can never suddenly auto-route just
    // because the switch was flipped on later.
    AI_AUTO_ROUTE_ACCEPT_CUTOVER_AT: z.string().optional(),
    FAWTARA_MODE: z.enum(['mock', 'sandbox', 'production']).default('mock'),
    SMTP_MODE: z.enum(['mock', 'sandbox', 'production']).default('mock'),
    PLESK_MODE: z.enum(['mock', 'sandbox', 'production']).default('mock'),
    SMARTERMAIL_MODE: z.enum(['mock', 'sandbox', 'production']).default('mock'),
    // Phase 3 Slice B — outbound mail master switch. Real SMTP transmission must remain off by
    // default; see MailOutboundService. MAIL_SEND_CUTOVER_AT is required whenever sending is
    // enabled, and is validated below (fail closed rather than inferring approval for old rows).
    MAIL_SEND_ENABLED: z.enum(['true', 'false']).default('false'),
    MAIL_SEND_CUTOVER_AT: z.string().optional(),
    // Phase 3 Slice C — inbound IMAP sync master switch, off by default. IMAP_MODE follows the
    // same shape as SMTP_MODE; see MailInboundIngestService/mailbox-reader.ts. The fail-closed
    // rule below (production + enabled + mock) mirrors MAIL_SEND_ENABLED/SMTP_MODE's own rule.
    IMAP_SYNC_ENABLED: z.enum(['true', 'false']).default('false'),
    IMAP_MODE: z.enum(['mock', 'real']).default('mock'),
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
    if (value.MAIL_SEND_ENABLED === 'true') {
      const parsed = value.MAIL_SEND_CUTOVER_AT ? Date.parse(value.MAIL_SEND_CUTOVER_AT) : NaN;
      if (!value.MAIL_SEND_CUTOVER_AT || Number.isNaN(parsed)) {
        context.addIssue({
          code: 'custom',
          path: ['MAIL_SEND_CUTOVER_AT'],
          message:
            'a valid ISO-8601 MAIL_SEND_CUTOVER_AT is required whenever MAIL_SEND_ENABLED=true (fail closed: sending must never be enabled without an explicit cutover)',
        });
      }
    }
    if (value.NODE_ENV === 'production' && value.MAIL_SEND_ENABLED === 'true' && value.SMTP_MODE === 'mock') {
      context.addIssue({
        code: 'custom',
        path: ['SMTP_MODE'],
        message:
          'SMTP_MODE=mock is forbidden in production while MAIL_SEND_ENABLED=true — a production runtime must never mark customer messages DELIVERED through a mock transport',
      });
    }
    if (value.NODE_ENV === 'production' && value.IMAP_SYNC_ENABLED === 'true' && value.IMAP_MODE === 'mock') {
      context.addIssue({
        code: 'custom',
        path: ['IMAP_MODE'],
        message:
          'IMAP_MODE=mock is forbidden in production while IMAP_SYNC_ENABLED=true — a production runtime must never appear to sync mail through a fake mailbox reader',
      });
    }
    if (value.NODE_ENV === 'production' && value.AI_ENABLED === 'true' && value.AI_PROVIDER === 'mock') {
      context.addIssue({
        code: 'custom',
        path: ['AI_PROVIDER'],
        message:
          'AI_PROVIDER=mock is forbidden in production while AI_ENABLED=true — a production runtime must never appear to classify mail through a fake model',
      });
    }
    if (value.AI_ENABLED === 'true' && value.AI_PROVIDER === 'openai' && (!value.AI_MODEL || !value.AI_API_KEY)) {
      context.addIssue({
        code: 'custom',
        path: ['AI_MODEL'],
        message: 'AI_MODEL and AI_API_KEY are both required whenever AI_ENABLED=true and AI_PROVIDER=openai',
      });
    }
    // Phase 3 Slice G — the deprecated combined switch must never silently activate routing, and
    // must never be silently aliased to the new switch either (it previously performed no business
    // action, so treating it as equivalent to AI_AUTO_ROUTE_ACCEPT=true would be a behavior change
    // no deployment ever opted into). Fail closed with an explicit message instead.
    if (value.AI_AUTO_ROUTE_ACCEPT_REJECT === 'true') {
      context.addIssue({
        code: 'custom',
        path: ['AI_AUTO_ROUTE_ACCEPT_REJECT'],
        message:
          'AI_AUTO_ROUTE_ACCEPT_REJECT is deprecated and performs no business action in this version — remove it and set AI_AUTO_ROUTE_ACCEPT explicitly (with AI_ENABLED=true and AI_AUTO_ROUTE_ACCEPT_CUTOVER_AT) if automatic acceptance routing is intended',
      });
    }
    if (value.AI_AUTO_ROUTE_ACCEPT === 'true') {
      if (value.AI_ENABLED !== 'true') {
        context.addIssue({
          code: 'custom',
          path: ['AI_AUTO_ROUTE_ACCEPT'],
          message: 'AI_ENABLED must be true whenever AI_AUTO_ROUTE_ACCEPT=true',
        });
      }
      const parsedCutover = value.AI_AUTO_ROUTE_ACCEPT_CUTOVER_AT ? Date.parse(value.AI_AUTO_ROUTE_ACCEPT_CUTOVER_AT) : NaN;
      if (!value.AI_AUTO_ROUTE_ACCEPT_CUTOVER_AT || Number.isNaN(parsedCutover)) {
        context.addIssue({
          code: 'custom',
          path: ['AI_AUTO_ROUTE_ACCEPT_CUTOVER_AT'],
          message:
            'a valid ISO-8601 AI_AUTO_ROUTE_ACCEPT_CUTOVER_AT is required whenever AI_AUTO_ROUTE_ACCEPT=true (fail closed: automatic acceptance routing must never activate without an explicit cutover boundary)',
        });
      }
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
