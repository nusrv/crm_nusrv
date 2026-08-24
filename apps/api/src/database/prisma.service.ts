import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../generated/prisma/client';
import { toMariaDbDriverUrl } from './mariadb-url';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(config: ConfigService) {
    const databaseUrl = config.getOrThrow<string>('DATABASE_URL');
    super({ adapter: new PrismaMariaDb(toMariaDbDriverUrl(databaseUrl)) });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
