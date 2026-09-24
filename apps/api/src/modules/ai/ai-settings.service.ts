import { BadRequestException, Injectable } from '@nestjs/common';
import { AuditService } from '../../audit/audit.service';
import type { MutationContext } from '../../common/mutation-context';
import { PrismaService } from '../../database/prisma.service';
import { ActorType, HealthStatus } from '../../generated/prisma/enums';
import type { AiSettings, Prisma } from '../../generated/prisma/client';
import { SecretEncryptionService } from '../../security/secret-encryption.service';
import { AiHealthService } from './ai-health.service';
import { AiSettingsResolverService } from './ai-settings-resolver.service';
import type { UpdateAiSettingsDto } from './ai-settings.dto';
import { LlmMalformedOutputError, LlmPermanentError, LlmTransientError } from './llm-errors';
import { LlmProviderRegistry } from './llm-provider-registry.service';

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

@Injectable()
export class AiSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: SecretEncryptionService,
    private readonly audit: AuditService,
    private readonly health: AiHealthService,
    private readonly aiSettings: AiSettingsResolverService,
    private readonly providerRegistry: LlmProviderRegistry,
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
   *
   * Provider-neutral correction §G — changing `provider` is a CREDENTIAL-SAFETY boundary, not just
   * another field: switching providers must never silently reuse the previous provider's model or
   * API key (an OpenAI key sent to Anthropic, or vice versa, is never even attempted). A provider
   * change REQUIRES both a new `model` and a new `apiKey` in the SAME request; either missing (or
   * `clearApiKey` instead of a real new key) rejects the whole update with no partial effect — every
   * check below runs, and can throw, strictly BEFORE the transaction that actually persists `data`,
   * so a rejected switch never clears/overwrites the previously valid configuration.
   */
  async update(dto: UpdateAiSettingsDto, context: MutationContext): Promise<SerializedAiSettings> {
    if (dto.apiKey !== undefined && dto.clearApiKey) {
      throw new BadRequestException('Provide a new API key or clear it, not both.');
    }

    const existing = await this.prisma.aiSettings.findUnique({ where: { singleton: true } });
    const oldState = existing ? this.serialize(existing) : SAFE_DEFAULTS;

    const nextProvider = dto.provider ?? existing?.provider ?? 'OPENAI';
    const providerChanged = existing !== null && nextProvider !== existing.provider;
    if (providerChanged) {
      if (dto.model === undefined) {
        throw new BadRequestException('Changing AI provider requires a new model for the selected provider.');
      }
      if (dto.clearApiKey) {
        throw new BadRequestException('Changing AI provider requires a new API key, not clearing the existing one.');
      }
      if (dto.apiKey === undefined) {
        throw new BadRequestException('Changing AI provider requires a new API key for the selected provider.');
      }
    }

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
      provider: nextProvider,
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
            providerChanged,
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
   * Phase 3.1 §K, corrected by §4 and made provider-neutral by §K — explicit ADMIN action only.
   * Resolves model/API key through the EXACT SAME `AiSettingsResolverService`, and dispatches to the
   * EXACT SAME `LlmProviderRegistry` DynamicLlmGateway uses at real classification time (never a
   * separate, independently-duplicated selection) — a successful Test AI is therefore a direct proof
   * that "the runtime would use this same provider/model/credential configuration," for whichever
   * provider is currently selected (OpenAI, Anthropic, or Google Gemini), not merely a
   * coincidentally-similar check, and never a hidden OpenAI-only implementation. Calls only the
   * adapter's `testConnection()` — one minimal, harmless request, deliberately NEVER through
   * LlmGateway/AiClassificationService's classifyIntent()/draftReply() (those are reserved for the
   * real classification/drafting prompts and schemas). Creates no AiClassification, no
   * AiRoutingDecision, sends no email, mutates no RenewalCase. Deliberately does NOT require
   * `enabled: true` — an admin must be able to test a model/key before ever flipping AI on.
   */
  async test(): Promise<{ success: boolean; provider: string; model: string | null; timestamp: Date; latencyMs?: number; message: string }> {
    const settings = await this.aiSettings.getSettings();
    const timestamp = new Date();
    const apiKey = await this.aiSettings.getApiKey();
    if (!settings.model || !apiKey) {
      return { success: false, provider: settings.provider, model: settings.model, timestamp, message: 'Provider/model/API key are not fully configured.' };
    }
    const adapter = this.providerRegistry.resolve(settings.provider);
    if (!adapter) {
      return { success: false, provider: settings.provider, model: settings.model, timestamp, message: `Unsupported AI provider "${settings.provider}".` };
    }

    try {
      const { latencyMs } = await adapter.testConnection({ model: settings.model, apiKey });
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

  /** Never a raw provider error (may carry request/response headers or an echo of the request) —
   * every adapter's testConnection() already normalizes its own failures into one of the three typed
   * LlmGateway errors (llm-errors.ts) with an already-safe, fixed message before it ever reaches
   * here, so this only needs to trust that contract, never re-inspect a provider-specific shape. */
  private sanitizeError(error: unknown): string {
    if (error instanceof LlmTransientError || error instanceof LlmPermanentError || error instanceof LlmMalformedOutputError) {
      return error.message;
    }
    return 'Connection or request error.';
  }
}
