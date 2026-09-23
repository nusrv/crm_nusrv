import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { ClockService } from '../../time/clock.service';
import type { MailConfiguration } from '../../generated/prisma/client';
import { isMailConfigEnvironmentAllowed } from './mail-environment-guard';

export type MailConfigurationUnusableReason =
  | 'BILLING_ENTITY_OVERRIDE_DISABLED'
  | 'NO_CONFIGURATION'
  | 'GLOBAL_DISABLED'
  | 'ENVIRONMENT_MISMATCH'
  | 'OUTBOUND_SEND_DISABLED'
  | 'OUTBOUND_SEND_CUTOVER_NOT_REACHED'
  | 'PINNED_CONFIGURATION_MISSING'
  | 'PINNED_CONFIGURATION_DISABLED';

export type MailConfigurationResolution =
  | { usable: true; config: MailConfiguration }
  | { usable: false; reason: MailConfigurationUnusableReason };

export interface ResolveOutboundOptions {
  /** false for OperatorReplyOutboundService only — see resolvePinned()'s doc comment. */
  checkCutover: boolean;
}

const DEFAULT_RESOLVE_OUTBOUND_OPTIONS: ResolveOutboundOptions = { checkCutover: true };

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
    private readonly clock: ClockService,
  ) {}

  async resolveForOutbound(
    billingEntityId: string,
    options: ResolveOutboundOptions = DEFAULT_RESOLVE_OUTBOUND_OPTIONS,
  ): Promise<MailConfigurationResolution> {
    const override = await this.prisma.mailConfiguration.findFirst({ where: { billingEntityId } });
    if (override) {
      if (!override.enabled) return { usable: false, reason: 'BILLING_ENTITY_OVERRIDE_DISABLED' };
      return this.applyOutboundGuards(override, options);
    }

    const global = await this.prisma.mailConfiguration.findFirst({
      where: { billingEntityId: null },
    });
    if (!global) return { usable: false, reason: 'NO_CONFIGURATION' };
    if (!global.enabled) return { usable: false, reason: 'GLOBAL_DISABLED' };
    return this.applyOutboundGuards(global, options);
  }

  /**
   * Validates an already-pinned MailConfiguration (one a CommunicationThread/EmailMessage was
   * already materialized against) without re-running BillingEntity/GLOBAL resolution. Retries and
   * later messages in the same RenewalCase thread must stay pinned to their original mailbox
   * identity rather than silently picking up whatever resolveForOutbound() would choose today —
   * see MailOutboundService.resolveMailConfigurationForRow().
   *
   * `options.checkCutover` defaults true (MailOutboundService's ordinary reminder-send contract).
   * OperatorReplyOutboundService explicitly passes `{ checkCutover: false }` — see that service's
   * own processBatch() doc comment for why a cutover watermark must never gate a human-initiated
   * reply (it would risk permanently stranding a one-of-a-kind message).
   */
  resolvePinned(
    config: MailConfiguration | null,
    options: ResolveOutboundOptions = DEFAULT_RESOLVE_OUTBOUND_OPTIONS,
  ): MailConfigurationResolution {
    if (!config) return { usable: false, reason: 'PINNED_CONFIGURATION_MISSING' };
    if (!config.enabled) return { usable: false, reason: 'PINNED_CONFIGURATION_DISABLED' };
    return this.applyOutboundGuards(config, options);
  }

  private applyEnvironmentGuard(config: MailConfiguration): MailConfigurationResolution {
    const nodeEnv = this.config.get<string>('NODE_ENV') ?? 'development';
    if (!isMailConfigEnvironmentAllowed(config.environment, nodeEnv)) {
      return { usable: false, reason: 'ENVIRONMENT_MISMATCH' };
    }
    return { usable: true, config };
  }

  /**
   * Phase 3.1 §D — the per-mailbox, admin-managed, restart-free operational gate for outbound
   * sending. `outboundSendEnabled` is ALWAYS required (both MailOutboundService and
   * OperatorReplyOutboundService route through this). `outboundSendCutoverAt` is only checked when
   * `options.checkCutover` is true — see resolvePinned()'s doc comment for why
   * OperatorReplyOutboundService opts out. Evaluated AFTER the environment guard, on every call,
   * never cached — a Settings-UI change takes effect on the very next resolution attempt.
   * `outboundSendCutoverAt: null` behaves exactly like an env MAIL_SEND_CUTOVER_AT that was never
   * configured: never usable under a cutover check, even if outboundSendEnabled is true — both must
   * be set together for cutover-checked callers.
   */
  private applyOutboundGuards(config: MailConfiguration, options: ResolveOutboundOptions): MailConfigurationResolution {
    const environmentResult = this.applyEnvironmentGuard(config);
    if (!environmentResult.usable) return environmentResult;
    if (!config.outboundSendEnabled) return { usable: false, reason: 'OUTBOUND_SEND_DISABLED' };
    if (options.checkCutover && (!config.outboundSendCutoverAt || this.clock.now() < config.outboundSendCutoverAt)) {
      return { usable: false, reason: 'OUTBOUND_SEND_CUTOVER_NOT_REACHED' };
    }
    return { usable: true, config };
  }
}
