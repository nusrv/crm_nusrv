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
    CAPTCHA_PROVIDER: z.enum(['mock', 'turnstile', 'recaptcha']).default('mock'),
    CAPTCHA_TEST_TOKEN: z.string().min(8).optional(),
    CAPTCHA_SITE_KEY: z.string().optional(),
    CAPTCHA_SECRET: z.string().optional(),
    AI_ENABLED: z.enum(['true', 'false']).default('false'),
    AI_PROVIDER: z.string().optional(),
    AI_MODEL: z.string().optional(),
    AI_API_KEY: z.string().optional(),
    FAWTARA_MODE: z.enum(['mock', 'sandbox', 'production']).default('mock'),
    SMTP_MODE: z.enum(['mock', 'sandbox', 'production']).default('mock'),
    PLESK_MODE: z.enum(['mock', 'sandbox', 'production']).default('mock'),
    SMARTERMAIL_MODE: z.enum(['mock', 'sandbox', 'production']).default('mock'),
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
    if (value.CAPTCHA_PROVIDER !== 'mock' && (!value.CAPTCHA_SITE_KEY || !value.CAPTCHA_SECRET)) {
      context.addIssue({
        code: 'custom',
        path: ['CAPTCHA_SECRET'],
        message: 'CAPTCHA site key and secret are required for a production provider',
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
