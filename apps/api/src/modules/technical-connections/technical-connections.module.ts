import { Module } from '@nestjs/common';
import { TechnicalConnectionsController } from './technical-connections.controller';
import { TechnicalConnectionsService } from './technical-connections.service';

@Module({ controllers: [TechnicalConnectionsController], providers: [TechnicalConnectionsService] })
export class TechnicalConnectionsModule {}
