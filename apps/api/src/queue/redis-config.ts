import type { ConfigService } from '@nestjs/config';

export interface RedisConnectionOptions {
  host: string;
  port: number;
  username?: string;
  password?: string;
  db: number;
  tls?: Record<string, never>;
}

export function redisConnectionOptions(config: ConfigService): RedisConnectionOptions {
  const redisUrl = config.get<string>('REDIS_URL');
  if (redisUrl) {
    const url = new URL(redisUrl);
    return {
      host: url.hostname,
      port: Number(url.port || 6379),
      username: url.username ? decodeURIComponent(url.username) : undefined,
      password: url.password ? decodeURIComponent(url.password) : undefined,
      db: url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0,
      tls: url.protocol === 'rediss:' ? {} : undefined,
    };
  }

  return {
    host: config.getOrThrow<string>('REDIS_HOST'),
    port: config.get<number>('REDIS_PORT') ?? 6379,
    username: config.get<string>('REDIS_USERNAME') || undefined,
    password: config.get<string>('REDIS_PASSWORD') || undefined,
    db: config.get<number>('REDIS_DB') ?? 0,
    tls: config.get<string>('REDIS_TLS') === 'true' ? {} : undefined,
  };
}
