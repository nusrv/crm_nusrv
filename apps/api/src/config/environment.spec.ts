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
});
