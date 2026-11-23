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

  /**
   * P2.A informational only: no IMAP/provider probe, no new Sent/DSN sync,
   * and no cursor or delivery-state mutations.
   */
  @Roles('ADMIN', 'IT')
  @Get('evidence-sources')
  getEvidenceSources() {
    return this.health.getEvidenceSources();
  }
}
