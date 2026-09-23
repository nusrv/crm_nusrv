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

  it('accepts CAPTCHA_PROVIDER=none in production without CAPTCHA credentials', () => {
    expect(
      validateEnvironment({
        ...valid,
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

  it('defaults MAIL_SEND_ENABLED to false and leaves MAIL_SEND_CUTOVER_AT optional', () => {
    const result = validateEnvironment(valid);
    expect(result.MAIL_SEND_ENABLED).toBe('false');
    expect(result.MAIL_SEND_CUTOVER_AT).toBeUndefined();
  });

  it('fails closed: rejects MAIL_SEND_ENABLED=true with no cutover configured', () => {
    expect(() => validateEnvironment({ ...valid, MAIL_SEND_ENABLED: 'true' })).toThrow(
      'Invalid environment configuration',
    );
  });

  it('fails closed: rejects MAIL_SEND_ENABLED=true with an unparseable cutover', () => {
    expect(() =>
      validateEnvironment({ ...valid, MAIL_SEND_ENABLED: 'true', MAIL_SEND_CUTOVER_AT: 'not-a-date' }),
    ).toThrow('Invalid environment configuration');
  });

  it('accepts MAIL_SEND_ENABLED=true with a valid ISO-8601 cutover', () => {
    expect(
      validateEnvironment({
        ...valid,
        MAIL_SEND_ENABLED: 'true',
        MAIL_SEND_CUTOVER_AT: '2026-01-01T00:00:00.000Z',
      }),
    ).toMatchObject({ MAIL_SEND_ENABLED: 'true', MAIL_SEND_CUTOVER_AT: '2026-01-01T00:00:00.000Z' });
  });

  it('fails closed: rejects production with mail sending enabled through SMTP_MODE=mock', () => {
    expect(() =>
      validateEnvironment({
        ...valid,
        NODE_ENV: 'production',
        CAPTCHA_PROVIDER: 'none',
        CAPTCHA_TEST_TOKEN: undefined,
        MAIL_SEND_ENABLED: 'true',
        MAIL_SEND_CUTOVER_AT: '2026-01-01T00:00:00.000Z',
        SMTP_MODE: 'mock',
      }),
    ).toThrow('Invalid environment configuration');
  });

  it('accepts production with mail sending enabled through a real SMTP_MODE', () => {
    expect(
      validateEnvironment({
        ...valid,
        NODE_ENV: 'production',
        CAPTCHA_PROVIDER: 'none',
        CAPTCHA_TEST_TOKEN: undefined,
        MAIL_SEND_ENABLED: 'true',
        MAIL_SEND_CUTOVER_AT: '2026-01-01T00:00:00.000Z',
        SMTP_MODE: 'production',
      }),
    ).toMatchObject({ NODE_ENV: 'production', SMTP_MODE: 'production' });
  });

  it('allows SMTP_MODE=mock outside production even with mail sending enabled', () => {
    expect(
      validateEnvironment({
        ...valid,
        MAIL_SEND_ENABLED: 'true',
        MAIL_SEND_CUTOVER_AT: '2026-01-01T00:00:00.000Z',
        SMTP_MODE: 'mock',
      }),
    ).toMatchObject({ SMTP_MODE: 'mock' });
  });

  it('defaults IMAP_SYNC_ENABLED to false and IMAP_MODE to mock', () => {
    const result = validateEnvironment(valid);
    expect(result.IMAP_SYNC_ENABLED).toBe('false');
    expect(result.IMAP_MODE).toBe('mock');
  });

  it('fails closed: rejects production with IMAP sync enabled through IMAP_MODE=mock', () => {
    expect(() =>
      validateEnvironment({
        ...valid,
        NODE_ENV: 'production',
        CAPTCHA_PROVIDER: 'none',
        CAPTCHA_TEST_TOKEN: undefined,
        IMAP_SYNC_ENABLED: 'true',
        IMAP_MODE: 'mock',
      }),
    ).toThrow('Invalid environment configuration');
  });

  it('accepts production with IMAP sync enabled through IMAP_MODE=real', () => {
    expect(
      validateEnvironment({
        ...valid,
        NODE_ENV: 'production',
        CAPTCHA_PROVIDER: 'none',
        CAPTCHA_TEST_TOKEN: undefined,
        IMAP_SYNC_ENABLED: 'true',
        IMAP_MODE: 'real',
      }),
    ).toMatchObject({ NODE_ENV: 'production', IMAP_MODE: 'real' });
  });

  it('allows IMAP_MODE=mock outside production even with IMAP sync enabled', () => {
    expect(
      validateEnvironment({ ...valid, IMAP_SYNC_ENABLED: 'true', IMAP_MODE: 'mock' }),
    ).toMatchObject({ IMAP_MODE: 'mock' });
  });

  it('rejects an IMAP_MODE outside the mock/real enum', () => {
    expect(() => validateEnvironment({ ...valid, IMAP_MODE: 'sandbox' })).toThrow(
      'Invalid environment configuration',
    );
  });

  it('§34 — defaults AI_ENABLED=false, AI_PROVIDER=mock, AI_CONFIDENCE_THRESHOLD=0.90, AI_AUTO_ROUTE_ACCEPT_REJECT=false', () => {
    const result = validateEnvironment(valid);
    expect(result.AI_ENABLED).toBe('false');
    expect(result.AI_PROVIDER).toBe('mock');
    expect(result.AI_CONFIDENCE_THRESHOLD).toBe(0.9);
    expect(result.AI_AUTO_ROUTE_ACCEPT_REJECT).toBe('false');
  });

  it('§34 — production + AI_ENABLED=true + AI_PROVIDER=mock fails closed', () => {
    expect(() =>
      validateEnvironment({
        ...valid,
        NODE_ENV: 'production',
        CAPTCHA_PROVIDER: 'none',
        CAPTCHA_TEST_TOKEN: undefined,
        AI_ENABLED: 'true',
        AI_PROVIDER: 'mock',
      }),
    ).toThrow('Invalid environment configuration');
  });

  it('§34 — AI_ENABLED=true + AI_PROVIDER=openai without AI_MODEL/AI_API_KEY fails closed', () => {
    expect(() =>
      validateEnvironment({ ...valid, AI_ENABLED: 'true', AI_PROVIDER: 'openai' }),
    ).toThrow('Invalid environment configuration');
    expect(() =>
      validateEnvironment({ ...valid, AI_ENABLED: 'true', AI_PROVIDER: 'openai', AI_MODEL: 'gpt-test' }),
    ).toThrow('Invalid environment configuration');
  });

  it('§34 — AI_ENABLED=true + AI_PROVIDER=openai with both AI_MODEL and AI_API_KEY configured succeeds', () => {
    expect(
      validateEnvironment({
        ...valid,
        NODE_ENV: 'production',
        CAPTCHA_PROVIDER: 'none',
        CAPTCHA_TEST_TOKEN: undefined,
        AI_ENABLED: 'true',
        AI_PROVIDER: 'openai',
        AI_MODEL: 'gpt-test',
        AI_API_KEY: 'sk-test',
      }),
    ).toMatchObject({ AI_PROVIDER: 'openai', AI_MODEL: 'gpt-test' });
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

  it('Slice G §2/25.B — AI_AUTO_ROUTE_ACCEPT=true without a cutover fails validation', () => {
    expect(() =>
      validateEnvironment({ ...valid, AI_ENABLED: 'true', AI_AUTO_ROUTE_ACCEPT: 'true' }),
    ).toThrow('AI_AUTO_ROUTE_ACCEPT_CUTOVER_AT');
  });

  it('Slice G — AI_AUTO_ROUTE_ACCEPT=true with a malformed (non-ISO) cutover fails validation', () => {
    expect(() =>
      validateEnvironment({
        ...valid,
        AI_ENABLED: 'true',
        AI_AUTO_ROUTE_ACCEPT: 'true',
        AI_AUTO_ROUTE_ACCEPT_CUTOVER_AT: 'not-a-date',
      }),
    ).toThrow('AI_AUTO_ROUTE_ACCEPT_CUTOVER_AT');
  });

  it('Slice G — AI_AUTO_ROUTE_ACCEPT=true requires AI_ENABLED=true', () => {
    expect(() =>
      validateEnvironment({
        ...valid,
        AI_ENABLED: 'false',
        AI_AUTO_ROUTE_ACCEPT: 'true',
        AI_AUTO_ROUTE_ACCEPT_CUTOVER_AT: '2026-01-01T00:00:00.000Z',
      }),
    ).toThrow('AI_ENABLED must be true');
  });

  it('Slice G — AI_AUTO_ROUTE_ACCEPT=true with AI_ENABLED=true and a valid ISO cutover succeeds', () => {
    const result = validateEnvironment({
      ...valid,
      AI_ENABLED: 'true',
      AI_AUTO_ROUTE_ACCEPT: 'true',
      AI_AUTO_ROUTE_ACCEPT_CUTOVER_AT: '2026-01-01T00:00:00.000Z',
    });
    expect(result.AI_AUTO_ROUTE_ACCEPT).toBe('true');
    expect(result.AI_AUTO_ROUTE_ACCEPT_CUTOVER_AT).toBe('2026-01-01T00:00:00.000Z');
  });

  it('§34 — rejects an AI_PROVIDER outside the mock/openai enum', () => {
    expect(() => validateEnvironment({ ...valid, AI_PROVIDER: 'anthropic' })).toThrow(
      'Invalid environment configuration',
    );
  });
});
