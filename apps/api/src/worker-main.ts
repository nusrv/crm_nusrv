import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerAppModule } from './worker-app.module';

async function bootstrapWorker(): Promise<void> {
  const application = await NestFactory.createApplicationContext(WorkerAppModule, {
    bufferLogs: true,
  });
  application.enableShutdownHooks();
  new Logger('RenewalWorker').log('Renewal worker process is ready.');
}

void bootstrapWorker();
