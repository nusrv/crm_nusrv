import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { BullRegistrar } from '@nestjs/bullmq';
import { PrismaService } from './database/prisma.service';
import { registerP0Workers } from './queue/register-p0-workers';
import { WorkerAppModule } from './worker-app.module';

async function bootstrapWorker(): Promise<void> {
  const logger = new Logger('RenewalWorker');
  const application = await NestFactory.createApplicationContext(WorkerAppModule, {
    bufferLogs: true,
  });
  application.enableShutdownHooks();
  try {
    const config = application.get(ConfigService);
    await registerP0Workers(application.get(PrismaService), application.get(BullRegistrar), {
      sent: config.get<string>('P2_SENT_OBSERVATION_ENABLED') === 'true',
      review: config.get<string>('P2_DSN_REVIEW_CAPTURE_ENABLED') === 'true',
    });
  } catch {
    logger.error('Worker consumers could not be started. Verify database access, enabled feature schemas, and queue configuration.');
    process.exitCode = 1;
    await application.close();
    return;
  }
  logger.log('Renewal worker process is ready.');
}

void bootstrapWorker();
