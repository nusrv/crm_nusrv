import { redisConnectionOptions } from './redis-config';

describe('Redis staging configuration', () => {
  it('supports a TLS Redis URL with encoded credentials', () => {
    const config = {
      get: (key: string) =>
        key === 'REDIS_URL' ? 'rediss://queue%2Duser:p%40ss@redis.internal:6380/2' : undefined,
    };
    expect(redisConnectionOptions(config as never)).toEqual({
      host: 'redis.internal',
      port: 6380,
      username: 'queue-user',
      password: 'p@ss',
      db: 2,
      tls: {},
    });
  });

  it('supports Plesk staging host/port/auth/TLS variables without a URL', () => {
    const values: Record<string, unknown> = {
      REDIS_HOST: '127.0.0.1',
      REDIS_PORT: 6379,
      REDIS_USERNAME: 'cp-staging',
      REDIS_PASSWORD: 'secret',
      REDIS_DB: 3,
      REDIS_TLS: 'false',
    };
    const config = {
      get: (key: string) => values[key],
      getOrThrow: (key: string) => {
        if (values[key] === undefined) throw new Error(`Missing ${key}`);
        return values[key];
      },
    };
    expect(redisConnectionOptions(config as never)).toEqual({
      host: '127.0.0.1',
      port: 6379,
      username: 'cp-staging',
      password: 'secret',
      db: 3,
      tls: undefined,
    });
  });
});
