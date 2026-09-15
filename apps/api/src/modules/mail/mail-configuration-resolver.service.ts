import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import type { MailConfiguration } from '../../generated/prisma/client';
import { isMailConfigEnvironmentAllowed } from './mail-environment-guard';

export type MailConfigurationUnusableReason =
  | 'BILLING_ENTITY_OVERRIDE_DISABLED'
  | 'NO_CONFIGURATION'
  | 'GLOBAL_DISABLED'
  | 'ENVIRONMENT_MISMATCH'
  | 'PINNED_CONFIGURATION_MISSING'
  | 'PINNED_CONFIGURATION_DISABLED';

export type MailConfigurationResolution =
  | { usable: true; config: MailConfiguration }
  | { usable: false; reason: MailConfigurationUnusableReason };

/**
 * Slice B §7 — outbound MailConfiguration resolution. `scopeKey` is an internal application
 * invariant (never client-supplied — see the schema comment on MailConfiguration.scopeKey); no
 * client/controller CRUD work is introduced here, this is resolution logic only.
 *
 * Algorithm (exact order — do not reorder):
 *   1. Look for a BillingEntity-specific override.
 *   2. If an override EXISTS: enabled -> use it (subject to the environment guard below).
 *      Disabled -> sending is disabled for this BillingEntity. An explicitly disabled override
 *      has meaning and must never silently fall back to GLOBAL.
 *   3. If NO override exists: use GLOBAL if it exists and is enabled.
 *   4. Otherwise: no usable configuration; do not send.
 */
@Injectable()
export class MailConfigurationResolverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async resolveForOutbound(billingEntityId: string): Promise<MailConfigurationResolution> {
    const override = await this.prisma.mailConfiguration.findFirst({ where: { billingEntityId } });
    if (override) {
      if (!override.enabled) return { usable: false, reason: 'BILLING_ENTITY_OVERRIDE_DISABLED' };
      return this.applyEnvironmentGuard(override);
    }

    const global = await this.prisma.mailConfiguration.findFirst({
      where: { billingEntityId: null },
    });
    if (!global) return { usable: false, reason: 'NO_CONFIGURATION' };
    if (!global.enabled) return { usable: false, reason: 'GLOBAL_DISABLED' };
    return this.applyEnvironmentGuard(global);
  }

  /**
   * Validates an already-pinned MailConfiguration (one a CommunicationThread/EmailMessage was
   * already materialized against) without re-running BillingEntity/GLOBAL resolution. Retries and
   * later messages in the same RenewalCase thread must stay pinned to their original mailbox
   * identity rather than silently picking up whatever resolveForOutbound() would choose today —
   * see MailOutboundService.resolveMailConfigurationForRow().
   */
  resolvePinned(config: MailConfiguration | null): MailConfigurationResolution {
    if (!config) return { usable: false, reason: 'PINNED_CONFIGURATION_MISSING' };
    if (!config.enabled) return { usable: false, reason: 'PINNED_CONFIGURATION_DISABLED' };
    return this.applyEnvironmentGuard(config);
  }

  private applyEnvironmentGuard(config: MailConfiguration): MailConfigurationResolution {
    const nodeEnv = this.config.get<string>('NODE_ENV') ?? 'development';
    if (!isMailConfigEnvironmentAllowed(config.environment, nodeEnv)) {
      return { usable: false, reason: 'ENVIRONMENT_MISMATCH' };
    }
    return { usable: true, config };
  }
}
