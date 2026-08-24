import { Injectable } from '@nestjs/common';
import type { ReadinessResponse } from '@cp/shared';
import { PrismaService } from '../database/prisma.service';
import { RedisConnectionService } from '../queue/redis-connection.service';

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisConnectionService,
  ) {}

  liveness() {
    return { status: 'ok' as const };
  }

  async readiness(): Promise<ReadinessResponse> {
    const [database, redis] = await Promise.all([
      this.check(() => this.prisma.$queryRaw`SELECT 1`),
      this.check(() => this.redis.ping()),
    ]);
    return {
      status: database.status === 'up' && redis.status === 'up' ? 'ok' : 'degraded',
      services: { database, redis },
    };
  }

  private async check(operation: () => Promise<unknown>): Promise<{ status: 'up' | 'down' }> {
    try {
      await operation();
      return { status: 'up' };
    } catch {
      return { status: 'down' };
    }
  }
}
