import { Controller, Get } from '@nestjs/common';
import { Roles } from '../../identity/roles.decorator';
import { IntegrationHealthService } from './integration-health.service';

/** Phase 3.1 §L — Settings → Integration Health, read-only. Same ADMIN/IT viewing precedent as
 * MailSettingsController/AiSettingsController. */
@Controller('settings/health')
export class IntegrationHealthController {
  constructor(private readonly health: IntegrationHealthService) {}

  @Roles('ADMIN', 'IT')
  @Get()
  getOverview() {
    return this.health.getOverview();
  }
}
