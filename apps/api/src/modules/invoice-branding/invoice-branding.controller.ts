import {
  Body,
  Controller,
  Get,
  Ip,
  Param,
  Post,
  Put,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Roles } from '../../identity/roles.decorator';
import type { AuthenticatedRequest } from '../../identity/auth-user';
import { InvoiceBrandingService } from './invoice-branding.service';
@Controller('billing-entities/:entityId/invoice-branding')
export class InvoiceBrandingController {
  constructor(private readonly service: InvoiceBrandingService) {}
  @Get() @Roles('ADMIN', 'ACCOUNTANT') get(@Param('entityId') id: string) {
    return this.service.get(id);
  }
  @Put() @Roles('ADMIN') save(
    @Param('entityId') id: string,
    @Body() input: unknown,
    @Req() req: AuthenticatedRequest,
    @Ip() ip: string,
  ) {
    return this.service.save(id, input, { actorId: req.user.id, ipAddress: ip });
  }
  @Post('logos')
  @Roles('ADMIN')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 262144, files: 1 } }))
  upload(
    @Param('entityId') id: string,
    @UploadedFile() file: { buffer: Buffer; mimetype: string } | undefined,
    @Req() req: AuthenticatedRequest,
    @Ip() ip: string,
  ) {
    return this.service.uploadLogo(id, file, { actorId: req.user.id, ipAddress: ip });
  }
}
