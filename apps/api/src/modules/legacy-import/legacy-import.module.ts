import { Module } from '@nestjs/common';
import { LegacyImportController } from './legacy-import.controller';
import { LegacyImportService } from './legacy-import.service';

@Module({ controllers: [LegacyImportController], providers: [LegacyImportService] })
export class LegacyImportModule {}
