import { BadRequestException, Injectable } from '@nestjs/common';
import { AiSettingsResolverService } from './ai-settings-resolver.service';
import type { DiscoverAiModelsDto } from './ai-model-discovery.dto';
import { LlmMalformedOutputError, LlmPermanentError, LlmTransientError } from './llm-errors';
import { AI_PROVIDER_LABELS, type AiProviderId, type DiscoveredAiModel } from './llm-provider-adapter';
import { LlmProviderRegistry } from './llm-provider-registry.service';

export interface AiModelDiscoveryResult {
  success: boolean;
  provider: AiProviderId;
  models: DiscoveredAiModel[];
  message?: string;
}

/**
 * "n8n-style" dynamic model discovery correction — a deliberately separate operation from
 * `AiSettingsService.update()` ("Save"). Discovery NEVER writes AiSettings: no provider, no model,
 * no API key, no enablement change, no audit event, no IntegrationHealthEvent. It only proves a
 * credential can list models and returns the normalized result — see §H/§P of the correction spec.
 *
 * §F/§G temporary API key safety — when the request supplies `apiKey`, it is used ONLY for this one
 * discovery call, held in a local variable for the duration of this method, and never: saved,
 * encrypted, persisted, audited, logged, included in a thrown exception, returned, or cached. It
 * becomes persisted ONLY later if the ADMIN separately presses Save on the actual AI settings form
 * (`AiSettingsService.update()`), which re-validates everything independently.
 *
 * Case rules (§F):
 *   1. Same provider already saved, request omits `apiKey` -> the backend MAY use the saved,
 *      encrypted API key (decrypted server-side immediately before use, never returned) — this is
 *      what powers "Refresh Models".
 *   2. Switching to a different provider -> the previous provider's key is NEVER reused; `apiKey` is
 *      REQUIRED in the request, or this rejects with a safe, specific error.
 *   3. No configuration saved yet -> `apiKey` is REQUIRED.
 */
@Injectable()
export class AiModelDiscoveryService {
  constructor(
    private readonly aiSettings: AiSettingsResolverService,
    private readonly registry: LlmProviderRegistry,
  ) {}

  async discover(dto: DiscoverAiModelsDto): Promise<AiModelDiscoveryResult> {
    const adapter = this.registry.resolve(dto.provider);
    if (!adapter) {
      throw new BadRequestException(`Unsupported AI provider "${dto.provider}".`);
    }

    const apiKey = await this.resolveApiKey(dto);

    try {
      const models = await adapter.listModels(apiKey);
      return { success: true, provider: dto.provider, models: normalizeAndSortModels(models) };
    } catch (error) {
      return { success: false, provider: dto.provider, models: [], message: this.sanitizeError(error) };
    }
  }

  /** Never logs, persists, or echoes back whichever key it resolves to use. */
  private async resolveApiKey(dto: DiscoverAiModelsDto): Promise<string> {
    if (dto.apiKey) return dto.apiKey;

    const settings = await this.aiSettings.getSettings();
    if (settings.provider !== dto.provider) {
      throw new BadRequestException(`Enter an API key for ${AI_PROVIDER_LABELS[dto.provider]} before loading models.`);
    }
    const storedKey = await this.aiSettings.getApiKey();
    if (!storedKey) {
      throw new BadRequestException(`Enter an API key for ${AI_PROVIDER_LABELS[dto.provider]} before loading models.`);
    }
    return storedKey;
  }

  /** Never a raw provider error — every adapter's listModels() already normalizes its own failures
   * into one of the three typed LlmGateway errors (llm-errors.ts) with an already-safe, fixed
   * message before it ever reaches here, mirroring AiSettingsService.test()'s identical discipline. */
  private sanitizeError(error: unknown): string {
    if (error instanceof LlmTransientError || error instanceof LlmPermanentError || error instanceof LlmMalformedOutputError) {
      return error.message;
    }
    return 'Model discovery is temporarily unavailable.';
  }
}

/** §M — normalize/dedupe by exact model ID (a provider is never expected to return duplicates, but
 * pagination edge cases make it cheap defense-in-depth to guarantee anyway — the FIRST occurrence
 * wins, never merged), then a stable, deterministic sort (display name, tie-broken by id). Never
 * invents a "best model" ranking and never pre-selects one — the ADMIN always chooses. */
function normalizeAndSortModels(models: DiscoveredAiModel[]): DiscoveredAiModel[] {
  const byId = new Map<string, DiscoveredAiModel>();
  for (const model of models) {
    if (!byId.has(model.id)) byId.set(model.id, model);
  }
  return [...byId.values()].sort(
    (a, b) => a.displayName.localeCompare(b.displayName) || a.id.localeCompare(b.id),
  );
}
