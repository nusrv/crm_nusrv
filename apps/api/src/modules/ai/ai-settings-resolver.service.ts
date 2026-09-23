import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { SecretEncryptionService } from '../../security/secret-encryption.service';

export const AI_SETTINGS_DEFAULT_CONFIDENCE_THRESHOLD = 0.9;

export interface AiRuntimeSettings {
  enabled: boolean;
  provider: string;
  model: string | null;
  confidenceThreshold: number;
  autoRouteAcceptEnabled: boolean;
  autoRouteAcceptCutoverAt: Date | null;
}

interface StoredApiKeyEnvelope {
  apiKey: string;
}

/**
 * Phase 3.1 §J — the ONE place operational AI behavior is resolved from the persisted AiSettings
 * row, read fresh at execution time by every caller (AiClassificationService,
 * AiClassificationEnqueueService, AiClassificationWorker's recovery scan, AiRoutingService,
 * OpenAiLlmGateway) — exactly mirroring MailConfigurationResolverService's own "resolve at the
 * moment of use, never cache across calls" discipline, so a Settings-UI change takes effect on the
 * very next classification/routing attempt with no restart.
 *
 * NO ROW = FULLY DISABLED, ALWAYS (never an error, never a fallback to any environment variable) —
 * a fresh or freshly-migrated deployment must behave identically to AI_ENABLED=false ever having
 * existed. This is the single fail-closed default every other AI-side consumer relies on.
 *
 * `AI_PROVIDER` (env) remains the separate, unrelated, deployment-level switch that decides which
 * LlmGateway implementation is even wired into the DI container (mock vs. OpenAiLlmGateway) — see
 * llm-provider.module.ts. This resolver's `provider`/`enabled` fields never influence that wiring;
 * they only decide whether the wired gateway is actually USED for a given attempt.
 */
@Injectable()
export class AiSettingsResolverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: SecretEncryptionService,
  ) {}

  async getSettings(): Promise<AiRuntimeSettings> {
    const row = await this.prisma.aiSettings.findUnique({ where: { singleton: true } });
    if (!row) {
      return {
        enabled: false,
        provider: 'OPENAI',
        model: null,
        confidenceThreshold: AI_SETTINGS_DEFAULT_CONFIDENCE_THRESHOLD,
        autoRouteAcceptEnabled: false,
        autoRouteAcceptCutoverAt: null,
      };
    }
    return {
      enabled: row.enabled,
      provider: row.provider,
      model: row.model,
      confidenceThreshold: row.confidenceThreshold != null ? Number(row.confidenceThreshold) : AI_SETTINGS_DEFAULT_CONFIDENCE_THRESHOLD,
      autoRouteAcceptEnabled: row.autoRouteAccept,
      autoRouteAcceptCutoverAt: row.autoRouteAcceptCutoverAt,
    };
  }

  /** Decrypted lazily, immediately before use, and never cached — mirrors every other credential
   * read in this codebase (SmtpMailTransport/ImapMailboxReader's own doc comments). Returns null
   * when no key is configured; never throws for that case (a caller must treat null as "AI cannot
   * actually run," not as an error). */
  async getApiKey(): Promise<string | null> {
    const row = await this.prisma.aiSettings.findUnique({
      where: { singleton: true },
      select: { apiKeyCiphertext: true },
    });
    if (!row?.apiKeyCiphertext) return null;
    return this.encryption.decrypt<StoredApiKeyEnvelope>(row.apiKeyCiphertext).apiKey;
  }
}
