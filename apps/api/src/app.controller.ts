import { Controller, Get } from '@nestjs/common';
import { Public } from './identity/public.decorator';

@Controller()
export class AppController {
  @Public()
  @Get()
  metadata() {
    return {
      name: 'Customer Subscription Lifecycle Control Panel API',
      phase: 0,
    };
  }
}
