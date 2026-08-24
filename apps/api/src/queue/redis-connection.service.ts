import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { redisConnectionOptions } from './redis-config';

@Injectable()
export class RedisConnectionService implements OnModuleDestroy {
  private readonly client: Redis;

  constructor(config: ConfigService) {
    this.client = new Redis({
      ...redisConnectionOptions(config),
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    });
    this.client.on('error', () => undefined);
  }

  async ping(): Promise<'PONG'> {
    if (this.client.status === 'wait') await this.client.connect();
    return this.client.ping();
  }

  onModuleDestroy(): void {
    if (this.client.status !== 'end') this.client.disconnect();
  }
}
