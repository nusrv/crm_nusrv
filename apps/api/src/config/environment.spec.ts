import { validateEnvironment } from './environment';

const valid = {
  NODE_ENV: 'test',
  APP_URL: 'http://localhost:3000',
  WEB_URL: 'http://localhost:3000',
  API_URL: 'http://localhost:3001',
  DATABASE_URL: 'mysql://user:pass@localhost:3306/cp',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 3).toString('base64'),
  CAPTCHA_PROVIDER: 'mock',
  CAPTCHA_TEST_TOKEN: 'test-token',
};

describe('environment validation', () => {
  it('accepts a MariaDB/MySQL Prisma URL and applies safe mock defaults', () => {
    expect(validateEnvironment(valid)).toMatchObject({
      NODE_ENV: 'test',
      DATABASE_URL: valid.DATABASE_URL,
      BUSINESS_TIMEZONE: 'Asia/Amman',
      FAWTARA_MODE: 'mock',
      SMTP_MODE: 'mock',
    });
  });

  it('accepts individual Redis staging connection variables', () => {
    const withoutUrl = Object.fromEntries(
      Object.entries(valid).filter(([key]) => key !== 'REDIS_URL'),
    );
    expect(
      validateEnvironment({
        ...withoutUrl,
        REDIS_HOST: '127.0.0.1',
        REDIS_PORT: '6380',
        REDIS_USERNAME: 'staging',
        REDIS_PASSWORD: 'secret',
        REDIS_TLS: 'true',
      }),
    ).toMatchObject({
      REDIS_HOST: '127.0.0.1',
      REDIS_PORT: 6380,
      REDIS_USERNAME: 'staging',
      REDIS_TLS: 'true',
    });
  });

  it('requires either REDIS_URL or REDIS_HOST', () => {
    const withoutRedis = Object.fromEntries(
      Object.entries(valid).filter(([key]) => key !== 'REDIS_URL'),
    );
    expect(() => validateEnvironment(withoutRedis)).toThrow('Invalid environment configuration');
  });

  // Every production-NODE_ENV fixture below that expects SUCCESS must also set SMTP_MODE/IMAP_MODE
  // to a non-mock value, independently of whatever it's actually testing — see the unconditional
  // SMTP_MODE/IMAP_MODE-mock-forbidden-in-production rules (Phase 3.1 §D/§Q correction) further
  // down this file. A fixture that expects `.toThrow()` does not need this — any additional reason
  // to fail closed is harmless to that assertion.
  const productionMailModeDefaults = { SMTP_MODE: 'production', IMAP_MODE: 'real' } as const;

  it('accepts CAPTCHA_PROVIDER=none in production without CAPTCHA credentials', () => {
    expect(
      validateEnvironment({
        ...valid,
        ...productionMailModeDefaults,
        NODE_ENV: 'production',
        CAPTCHA_PROVIDER: 'none',
        CAPTCHA_TEST_TOKEN: undefined,
      }),
    ).toMatchObject({ NODE_ENV: 'production', CAPTCHA_PROVIDER: 'none' });
  });

  it.each(['turnstile', 'recaptcha'] as const)(
    'requires credentials for %s and accepts them when both are supplied',
    (provider) => {
      expect(() =>
        validateEnvironment({
          ...valid,
          NODE_ENV: 'production',
          CAPTCHA_PROVIDER: provider,
          CAPTCHA_TEST_TOKEN: undefined,
        }),
      ).toThrow('Invalid environment configuration');
      expect(
        validateEnvironment({
          ...valid,
          ...productionMailModeDefaults,
          NODE_ENV: 'production',
          CAPTCHA_PROVIDER: provider,
          CAPTCHA_TEST_TOKEN: undefined,
          CAPTCHA_SITE_KEY: 'site-key',
          CAPTCHA_SECRET: 'secret-key',
        }),
      ).toMatchObject({ CAPTCHA_PROVIDER: provider });
    },
  );

  it('keeps mock CAPTCHA prohibited in production', () => {
    expect(() => validateEnvironment({ ...valid, NODE_ENV: 'production' })).toThrow(
      'Invalid environment configuration',
    );
  });

  it('rejects an invalid business timezone', () => {
    expect(() => validateEnvironment({ ...valid, BUSINESS_TIMEZONE: 'Not/A_Zone' })).toThrow(
      'Invalid environment configuration',
    );
  });

  it('rejects a PostgreSQL application database URL', () => {
    expect(() =>
      validateEnvironment({ ...valid, DATABASE_URL: 'postgresql://user:pass@localhost:5432/cp' }),
    ).toThrow('Invalid environment configuration');
  });

  it('rejects short signing secrets independently of CAPTCHA configuration', () => {
    expect(() =>
      validateEnvironment({
        ...valid,
        NODE_ENV: 'production',
        CAPTCHA_PROVIDER: 'none',
        CAPTCHA_TEST_TOKEN: undefined,
        JWT_ACCESS_SECRET: 'short',
      }),
    ).toThrow('Invalid environment configuration');
  });

  // Phase 3.1 §J/§Q correction — MAIL_SEND_ENABLED/MAIL_SEND_CUTOVER_AT/AI_ENABLED/AI_PROVIDER/
  // AI_MODEL/AI_API_KEY/AI_AUTO_ROUTE_ACCEPT/AI_AUTO_ROUTE_ACCEPT_CUTOVER_AT are DEPRECATED/
  // PARSED-ONLY: none of them is cross-validated or read by the runtime any more (see
  // PHASES/PHASE_03_1_ADMIN_SETTINGS.md's env-status table). They still parse as plain, independent
  // fields for backward-compatible `.env` files.
  it('parses MAIL_SEND_ENABLED/MAIL_SEND_CUTOVER_AT as plain deprecated fields, with no cross-validation', () => {
    const result = validateEnvironment(valid);
    expect(result.MAIL_SEND_ENABLED).toBe('false');
    expect(result.MAIL_SEND_CUTOVER_AT).toBeUndefined();
    // No longer fails closed: MAIL_SEND_ENABLED=true with no cutover configured is valid to PARSE
    // (it is simply never read) — MailConfiguration.outboundSendCutoverAt is the sole authority now.
    expect(validateEnvironment({ ...valid, MAIL_SEND_ENABLED: 'true' })).toMatchObject({ MAIL_SEND_ENABLED: 'true' });
    expect(
      validateEnvironment({ ...valid, MAIL_SEND_ENABLED: 'true', MAIL_SEND_CUTOVER_AT: 'not-a-date' }),
    ).toMatchObject({ MAIL_SEND_CUTOVER_AT: 'not-a-date' }); // never parsed as a Date here — accepted as an opaque, unused string.
  });

  // Phase 3.1 §D/§Q correction — SMTP_MODE=mock is now UNCONDITIONALLY forbidden in production
  // (previously gated on MAIL_SEND_ENABLED=true, which is no longer authoritative).
  it('fails closed: rejects production with SMTP_MODE=mock regardless of MAIL_SEND_ENABLED', () => {
    expect(() =>
      validateEnvironment({
        ...valid,
        NODE_ENV: 'production',
        CAPTCHA_PROVIDER: 'none',
        CAPTCHA_TEST_TOKEN: undefined,
        MAIL_SEND_ENABLED: 'false',
        SMTP_MODE: 'mock',
      }),
    ).toThrow('Invalid environment configuration');
  });

  it('accepts production with a real SMTP_MODE', () => {
    expect(
      validateEnvironment({
        ...valid,
        NODE_ENV: 'production',
        CAPTCHA_PROVIDER: 'none',
        CAPTCHA_TEST_TOKEN: undefined,
        SMTP_MODE: 'production',
        IMAP_MODE: 'real',
      }),
    ).toMatchObject({ NODE_ENV: 'production', SMTP_MODE: 'production' });
  });

  it('allows SMTP_MODE=mock outside production', () => {
    expect(validateEnvironment({ ...valid, SMTP_MODE: 'mock' })).toMatchObject({ SMTP_MODE: 'mock' });
  });

  it('defaults IMAP_SYNC_ENABLED to false and IMAP_MODE to mock', () => {
    const result = validateEnvironment(valid);
    expect(result.IMAP_SYNC_ENABLED).toBe('false');
    expect(result.IMAP_MODE).toBe('mock');
  });

  // Phase 3.1 §D/§Q correction — same unconditional rule as SMTP_MODE.
  it('fails closed: rejects production with IMAP_MODE=mock regardless of IMAP_SYNC_ENABLED', () => {
    expect(() =>
      validateEnvironment({
        ...valid,
        NODE_ENV: 'production',
        CAPTCHA_PROVIDER: 'none',
        CAPTCHA_TEST_TOKEN: undefined,
        IMAP_SYNC_ENABLED: 'false',
        IMAP_MODE: 'mock',
      }),
    ).toThrow('Invalid environment configuration');
  });

  it('accepts production with IMAP_MODE=real', () => {
    expect(
      validateEnvironment({
        ...valid,
        NODE_ENV: 'production',
        CAPTCHA_PROVIDER: 'none',
        CAPTCHA_TEST_TOKEN: undefined,
        SMTP_MODE: 'production',
        IMAP_MODE: 'real',
      }),
    ).toMatchObject({ NODE_ENV: 'production', IMAP_MODE: 'real' });
  });

  it('allows IMAP_MODE=mock outside production', () => {
    expect(validateEnvironment({ ...valid, IMAP_MODE: 'mock' })).toMatchObject({ IMAP_MODE: 'mock' });
  });

  it('rejects an IMAP_MODE outside the mock/real enum', () => {
    expect(() => validateEnvironment({ ...valid, IMAP_MODE: 'sandbox' })).toThrow(
      'Invalid environment configuration',
    );
  });

  it('§34 — defaults AI_ENABLED=false, AI_PROVIDER=mock, AI_CONFIDENCE_THRESHOLD=0.90, AI_AUTO_ROUTE_ACCEPT_REJECT=false (all deprecated/parsed-only)', () => {
    const result = validateEnvironment(valid);
    expect(result.AI_ENABLED).toBe('false');
    expect(result.AI_PROVIDER).toBe('mock');
    expect(result.AI_CONFIDENCE_THRESHOLD).toBe(0.9);
    expect(result.AI_AUTO_ROUTE_ACCEPT_REJECT).toBe('false');
  });

  // Phase 3.1 §J correction — AI_PROVIDER/AI_ENABLED/AI_MODEL/AI_API_KEY no longer cross-validate
  // against each other or against NODE_ENV: none of them determines runtime provider selection any
  // more (AiSettingsResolverService/DynamicLlmGateway do), so a combination that used to fail closed
  // here is now simply an inert, unread set of values.
  it('no longer cross-validates AI_ENABLED/AI_PROVIDER/AI_MODEL/AI_API_KEY against each other or NODE_ENV=production', () => {
    expect(
      validateEnvironment({
        ...valid,
        ...productionMailModeDefaults,
        NODE_ENV: 'production',
        CAPTCHA_PROVIDER: 'none',
        CAPTCHA_TEST_TOKEN: undefined,
        AI_ENABLED: 'true',
        AI_PROVIDER: 'mock',
      }),
    ).toMatchObject({ AI_ENABLED: 'true', AI_PROVIDER: 'mock' });
    expect(validateEnvironment({ ...valid, AI_ENABLED: 'true', AI_PROVIDER: 'openai' })).toMatchObject({
      AI_PROVIDER: 'openai',
    });
  });

  it('§34 — an invalid confidence threshold outside 0..1 fails validation', () => {
    expect(() => validateEnvironment({ ...valid, AI_CONFIDENCE_THRESHOLD: '1.5' })).toThrow(
      'Invalid environment configuration',
    );
    expect(() => validateEnvironment({ ...valid, AI_CONFIDENCE_THRESHOLD: '-0.1' })).toThrow(
      'Invalid environment configuration',
    );
  });

  it('§34 — accepts confidence threshold at the exact boundaries 0 and 1', () => {
    expect(validateEnvironment({ ...valid, AI_CONFIDENCE_THRESHOLD: '0' }).AI_CONFIDENCE_THRESHOLD).toBe(0);
    expect(validateEnvironment({ ...valid, AI_CONFIDENCE_THRESHOLD: '1' }).AI_CONFIDENCE_THRESHOLD).toBe(1);
  });

  it('Slice G — AI_AUTO_ROUTE_ACCEPT_REJECT=true now fails validation: the deprecated combined switch must never silently activate routing', () => {
    expect(() => validateEnvironment({ ...valid, AI_AUTO_ROUTE_ACCEPT_REJECT: 'true' })).toThrow(
      'AI_AUTO_ROUTE_ACCEPT_REJECT is deprecated',
    );
  });

  it('Slice G — AI_AUTO_ROUTE_ACCEPT_REJECT=false (the default) remains valid plain config', () => {
    expect(validateEnvironment({ ...valid, AI_AUTO_ROUTE_ACCEPT_REJECT: 'false' })).toMatchObject({
      AI_AUTO_ROUTE_ACCEPT_REJECT: 'false',
    });
  });

  it('Slice G — defaults AI_AUTO_ROUTE_ACCEPT=false with no cutover required', () => {
    const result = validateEnvironment(valid);
    expect(result.AI_AUTO_ROUTE_ACCEPT).toBe('false');
  });

  // Phase 3.1 §J correction — AI_AUTO_ROUTE_ACCEPT/AI_AUTO_ROUTE_ACCEPT_CUTOVER_AT no longer
  // cross-validate against AI_ENABLED or each other: AiSettings.autoRouteAccept/
  // autoRouteAcceptCutoverAt (validated independently by AiSettingsService.update()) are the sole
  // runtime authority now.
  it('no longer cross-validates AI_AUTO_ROUTE_ACCEPT against AI_ENABLED or requires a cutover to parse', () => {
    expect(validateEnvironment({ ...valid, AI_ENABLED: 'true', AI_AUTO_ROUTE_ACCEPT: 'true' })).toMatchObject({
      AI_AUTO_ROUTE_ACCEPT: 'true',
    });
    expect(
      validateEnvironment({ ...valid, AI_ENABLED: 'false', AI_AUTO_ROUTE_ACCEPT: 'true' }),
    ).toMatchObject({ AI_AUTO_ROUTE_ACCEPT: 'true', AI_ENABLED: 'false' });
    expect(
      validateEnvironment({
        ...valid,
        AI_AUTO_ROUTE_ACCEPT: 'true',
        AI_AUTO_ROUTE_ACCEPT_CUTOVER_AT: 'not-a-date',
      }),
    ).toMatchObject({ AI_AUTO_ROUTE_ACCEPT_CUTOVER_AT: 'not-a-date' }); // accepted as an opaque, unused string.
  });

  it('§34 — rejects an AI_PROVIDER outside the mock/openai enum', () => {
    expect(() => validateEnvironment({ ...valid, AI_PROVIDER: 'anthropic' })).toThrow(
      'Invalid environment configuration',
    );
  });
});
