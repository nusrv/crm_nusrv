import { Controller, Get, Query } from '@nestjs/common';
import { CommunicationOutboxListQueryDto } from './renewal-cases.dto';
import { CommunicationOutboxService } from './communication-outbox.service';

@Controller('communication-outbox')
export class CommunicationOutboxController {
  constructor(private readonly outbox: CommunicationOutboxService) {}

  @Get()
  list(@Query() query: CommunicationOutboxListQueryDto) {
    return this.outbox.list(query);
  }
}
