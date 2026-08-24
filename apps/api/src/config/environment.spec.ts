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

  it('rejects short signing secrets and mock CAPTCHA in production', () => {
    expect(() =>
      validateEnvironment({ ...valid, NODE_ENV: 'production', JWT_ACCESS_SECRET: 'short' }),
    ).toThrow('Invalid environment configuration');
  });
});
