import { BadRequestException, Injectable } from '@nestjs/common';
import OpenAI, { APIError } from 'openai';
import { AuditService } from '../../audit/audit.service';
import type { MutationContext } from '../../common/mutation-context';
import { PrismaService } from '../../database/prisma.service';
import { ActorType, HealthStatus } from '../../generated/prisma/enums';
import type { AiSettings, Prisma } from '../../generated/prisma/client';
import { SecretEncryptionService } from '../../security/secret-encryption.service';
import { AiHealthService } from './ai-health.service';
import { AiSettingsResolverService } from './ai-settings-resolver.service';
import type { UpdateAiSettingsDto } from './ai-settings.dto';
import { AI_PROVIDER_TIMEOUT_MS } from './ai-timing.constants';

/** Serialized, browser-safe view of the one AiSettings row — never includes the API key or its
 * ciphertext. `apiKeyConfigured` is the only signal the browser ever gets about the key's presence. */
export interface SerializedAiSettings {
  enabled: boolean;
  provider: string;
  model: string | null;
  apiKeyConfigured: boolean;
  confidenceThreshold: number | null;
  autoRouteAccept: boolean;
  autoRouteAcceptCutoverAt: Date | null;
  updatedAt: Date | null;
}

const SAFE_DEFAULTS: SerializedAiSettings = {
  enabled: false,
  provider: 'OPENAI',
  model: null,
  apiKeyConfigured: false,
  confidenceThreshold: null,
  autoRouteAccept: false,
  autoRouteAcceptCutoverAt: null,
  updatedAt: null,
};

interface ApiKeyEnvelope {
  apiKey: string;
}

interface AiConnectionTestClientOptions {
  apiKey: string;
  timeout: number;
  maxRetries: number;
}

@Injectable()
export class AiSettingsService {
  /** Test seam only — mirrors OpenAiLlmGateway.clientFactory / SmtpMailTransport.transportFactory.
   * Defaults to the real OpenAI client constructor in production. */
  clientFactory: (options: AiConnectionTestClientOptions) => OpenAI = (options) => new OpenAI(options);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: SecretEncryptionService,
    private readonly audit: AuditService,
    private readonly health: AiHealthService,
    private readonly aiSettings: AiSettingsResolverService,
  ) {}

  async get(): Promise<SerializedAiSettings> {
    const row = await this.prisma.aiSettings.findUnique({ where: { singleton: true } });
    return row ? this.serialize(row) : SAFE_DEFAULTS;
  }

  /**
   * Upsert semantics (Phase 3.1 §H) — the FIRST call creates the one singleton row (DB-enforced by
   * `singleton @unique`), every later call updates it in place. Blank/omitted `apiKey` on an update
   * means KEEP the existing stored key; `clearApiKey: true` is the only way to actually remove it,
   * mirroring MailSettingsService's `clearCredentials` precedent exactly. §I — the API independently
   * re-validates every enablement precondition; the browser's own warning/confirmation UI is never
   * trusted as the actual safety boundary.
   */
  async update(dto: UpdateAiSettingsDto, context: MutationContext): Promise<SerializedAiSettings> {
    if (dto.apiKey !== undefined && dto.clearApiKey) {
      throw new BadRequestException('Provide a new API key or clear it, not both.');
    }

    const existing = await this.prisma.aiSettings.findUnique({ where: { singleton: true } });
    const oldState = existing ? this.serialize(existing) : SAFE_DEFAULTS;

    let apiKeyCiphertextUpdate: string | null | undefined;
    let credentialsChanged = false;
    if (dto.clearApiKey) {
      apiKeyCiphertextUpdate = null;
      credentialsChanged = true;
    } else if (dto.apiKey !== undefined) {
      apiKeyCiphertextUpdate = this.encryption.encrypt({ apiKey: dto.apiKey } satisfies ApiKeyEnvelope);
      credentialsChanged = true;
    }

    const nextEnabled = dto.enabled ?? existing?.enabled ?? false;
    const nextModel = dto.model ?? existing?.model ?? null;
    const nextApiKeyConfigured = dto.clearApiKey ? false : (dto.apiKey !== undefined ? true : Boolean(existing?.apiKeyCiphertext));
    const nextAutoRouteAccept = dto.autoRouteAccept ?? existing?.autoRouteAccept ?? false;
    const nextCutoverRaw = dto.autoRouteAcceptCutoverAt !== undefined ? dto.autoRouteAcceptCutoverAt : existing?.autoRouteAcceptCutoverAt?.toISOString();

    // §I — fail-closed, independently of the browser: AI cannot be enabled without a configured
    // model and API key; Auto Accept cannot be enabled without AI enabled, a configured model/key,
    // and a valid cutover.
    if (nextEnabled && (!nextModel || !nextApiKeyConfigured)) {
      throw new BadRequestException('AI cannot be enabled without a configured model and API key.');
    }
    if (nextAutoRouteAccept) {
      if (!nextEnabled) throw new BadRequestException('Automatic acceptance requires AI to be enabled.');
      if (!nextCutoverRaw || Number.isNaN(Date.parse(nextCutoverRaw))) {
        throw new BadRequestException('Automatic acceptance requires a valid cutover date/time.');
      }
    }

    const data: Prisma.AiSettingsUncheckedCreateInput = {
      singleton: true,
      enabled: nextEnabled,
      provider: 'OPENAI',
      model: nextModel,
      confidenceThreshold: dto.confidenceThreshold ?? (existing?.confidenceThreshold ? Number(existing.confidenceThreshold) : undefined),
      apiKeyCiphertext: apiKeyCiphertextUpdate !== undefined ? apiKeyCiphertextUpdate : existing?.apiKeyCiphertext,
      autoRouteAccept: nextAutoRouteAccept,
      autoRouteAcceptCutoverAt: dto.autoRouteAcceptCutoverAt !== undefined ? (dto.autoRouteAcceptCutoverAt ? new Date(dto.autoRouteAcceptCutoverAt) : null) : existing?.autoRouteAcceptCutoverAt,
    };

    const record = await this.prisma.$transaction(async (tx) => {
      const row = await tx.aiSettings.upsert({ where: { singleton: true }, create: data, update: data });
      const safe = this.serialize(row);
      await this.audit.record(
        {
          actorType: ActorType.USER,
          actorId: context.actorId,
          eventKey: existing ? 'settings.ai.updated' : 'settings.ai.created',
          subjectType: 'AiSettings',
          subjectId: row.id,
          oldState,
          newState: safe,
          metadata: {
            credentialsChanged,
            autoRouteAcceptChanged: dto.autoRouteAccept !== undefined && dto.autoRouteAccept !== (existing?.autoRouteAccept ?? false),
          },
          ipAddress: context.ipAddress,
        },
        tx,
      );
      return safe;
    });
    return record;
  }

  /**
   * Phase 3.1 §K, corrected by §4 — explicit ADMIN action only. Resolves model/API key through the
   * EXACT SAME `AiSettingsResolverService` DynamicLlmGateway/OpenAiLlmGateway use at real
   * classification time (never a separate, independently-duplicated read of the row) — a successful
   * Test AI is therefore a direct proof that "the runtime would use this same OpenAI configuration,"
   * not merely a coincidentally-similar check. Makes ONE minimal real OpenAI request (a raw SDK
   * call, deliberately NEVER through LlmGateway/AiClassificationService's classifyIntent()/
   * draftReply() — those are reserved for the real classification/drafting prompts and schemas).
   * Creates no AiClassification, no AiRoutingDecision, sends no email, mutates no RenewalCase.
   * Deliberately does NOT require `enabled: true` — an admin must be able to test a model/key before
   * ever flipping AI on.
   */
  async test(): Promise<{ success: boolean; provider: string; model: string | null; timestamp: Date; latencyMs?: number; message: string }> {
    const settings = await this.aiSettings.getSettings();
    const timestamp = new Date();
    const apiKey = await this.aiSettings.getApiKey();
    if (!settings.model || !apiKey) {
      return { success: false, provider: settings.provider, model: settings.model, timestamp, message: 'Provider/model/API key are not fully configured.' };
    }

    const client = this.clientFactory({ apiKey, timeout: AI_PROVIDER_TIMEOUT_MS, maxRetries: 0 });
    const startedAt = Date.now();
    try {
      await client.responses.create({ model: settings.model, input: 'connection test — reply with the single word OK.', max_output_tokens: 16 });
      const latencyMs = Date.now() - startedAt;
      await this.health.record(HealthStatus.HEALTHY, 'Manual AI connection test succeeded.');
      return { success: true, provider: settings.provider, model: settings.model, timestamp, latencyMs, message: 'AI connection succeeded.' };
    } catch (error) {
      const sanitized = this.sanitizeError(error);
      await this.health.record(HealthStatus.UNAVAILABLE, `Manual AI connection test failed: ${sanitized}`);
      return { success: false, provider: settings.provider, model: settings.model, timestamp, message: sanitized };
    }
  }

  private serialize(row: AiSettings): SerializedAiSettings {
    return {
      enabled: row.enabled,
      provider: row.provider,
      model: row.model,
      apiKeyConfigured: Boolean(row.apiKeyCiphertext),
      confidenceThreshold: row.confidenceThreshold != null ? Number(row.confidenceThreshold) : null,
      autoRouteAccept: row.autoRouteAccept,
      autoRouteAcceptCutoverAt: row.autoRouteAcceptCutoverAt,
      updatedAt: row.updatedAt,
    };
  }

  /** Never a raw SDK error (may carry request/response headers or an echo of the request) — only a
   * safe, fixed description plus (for an APIError) the HTTP status, mirroring
   * OpenAiLlmGateway's toLlmError()/SafeProviderErrorContext discipline exactly. */
  private sanitizeError(error: unknown): string {
    if (error instanceof APIError) {
      return `Provider error (status ${String(error.status)}).`;
    }
    return 'Connection or request error.';
  }
}
