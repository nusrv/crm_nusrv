import {
  Controller,
  Get,
  Ip,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
  Body,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { AuthenticatedRequest } from '../../identity/auth-user';
import { Roles } from '../../identity/roles.decorator';
import {
  ImportBatchListQueryDto,
  ImportRowListQueryDto,
  ReviewLegacyRowDto,
} from './legacy-import.dto';
import { LegacyImportService, type UploadedLegacyFile } from './legacy-import.service';

@Controller('legacy-import')
export class LegacyImportController {
  constructor(private readonly imports: LegacyImportService) {}

  @Roles('ADMIN', 'ACCOUNTANT', 'SALES_DEVELOPMENT')
  @Get('batches')
  listBatches(@Query() query: ImportBatchListQueryDto) {
    return this.imports.listBatches(query);
  }

  @Roles('ADMIN', 'ACCOUNTANT', 'SALES_DEVELOPMENT')
  @Get('batches/:id')
  getBatch(@Param('id') id: string) {
    return this.imports.getBatch(id);
  }

  @Roles('ADMIN', 'ACCOUNTANT', 'SALES_DEVELOPMENT')
  @Get('batches/:id/rows')
  listRows(@Param('id') id: string, @Query() query: ImportRowListQueryDto) {
    return this.imports.listRows(id, query);
  }

  @Roles('ADMIN')
  @Post('batches')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  createBatch(
    @UploadedFile() file: UploadedLegacyFile | undefined,
    @Req() req: AuthenticatedRequest,
    @Ip() ip: string,
  ) {
    return this.imports.createBatch(file, { actorId: req.user.id, ipAddress: ip });
  }

  @Roles('ADMIN', 'SALES_DEVELOPMENT')
  @Patch('rows/:id/review')
  reviewRow(
    @Param('id') id: string,
    @Body() input: ReviewLegacyRowDto,
    @Req() req: AuthenticatedRequest,
    @Ip() ip: string,
  ) {
    return this.imports.reviewRow(id, input, { actorId: req.user.id, ipAddress: ip });
  }

  @Roles('ADMIN')
  @Post('rows/:id/approve')
  approveRow(@Param('id') id: string, @Req() req: AuthenticatedRequest, @Ip() ip: string) {
    return this.imports.approveRow(id, { actorId: req.user.id, ipAddress: ip });
  }
}
