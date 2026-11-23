import 'reflect-metadata';
import { Logger } from '@nestjs/common';
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
    await registerP0Workers(application.get(PrismaService), application.get(BullRegistrar));
  } catch {
    logger.error('Worker consumers could not be started. Verify database access, P0 schema, and queue configuration.');
    process.exitCode = 1;
    await application.close();
    return;
  }
  logger.log('Renewal worker process is ready.');
}

void bootstrapWorker();
