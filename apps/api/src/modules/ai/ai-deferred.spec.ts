import { jest } from '@jest/globals';
import { AiClassificationEnqueueService } from './ai-classification-enqueue.service';
import { AiClassificationService } from './ai-classification.service';
import { AiModelDiscoveryService } from './ai-model-discovery.service';
import { AI_DEFERRED_MESSAGE } from './ai-operational-policy';
import { AI_CLASSIFY_JOB, AI_RECOVERY_JOB, AI_ROUTE_JOB, AI_ROUTING_RECOVERY_JOB } from './ai-queue.constants';
import { AiQueueService } from './ai-queue.service';
import { AiRoutingEnqueueService } from './ai-routing-enqueue.service';
import { AiRoutingService } from './ai-routing.service';
import { AiSettingsResolverService } from './ai-settings-resolver.service';
import { AiSettingsService } from './ai-settings.service';
import { AiClassificationWorker } from './ai.worker';
import { DynamicLlmGateway } from './dynamic-llm-gateway';
import { LlmProviderRegistry } from './llm-provider-registry.service';

describe('frozen AI operation policy', () => {
  const savedRow = {
    enabled: true,
    provider: 'OPENAI',
    model: 'example-model',
    apiKeyCiphertext: 'stored-key',
    confidenceThreshold: 0.97,
    autoRouteAccept: true,
    autoRouteAcceptCutoverAt: new Date(0),
    updatedAt: new Date(0),
  };

  function settingsFixture() {
    const prisma = { aiSettings: { findUnique: jest.fn().mockReturnValue(Promise.resolve(savedRow)) } };
    const encryption = { decrypt: jest.fn() };
    const resolver = new AiSettingsResolverService(prisma as never, encryption as never);
    return { prisma, encryption, resolver };
  }

  it('shows saved configuration as inactive, rejects enablement and preserves legacy flags', async () => {
    const { prisma, encryption, resolver } = settingsFixture();
    const service = new AiSettingsService(prisma as never, encryption as never, {} as never, {} as never, resolver, {} as never);

    expect(await service.get()).toMatchObject({
      enabled: false,
      autoRouteAccept: false,
      provider: savedRow.provider,
      model: savedRow.model,
      apiKeyConfigured: true,
      confidenceThreshold: savedRow.confidenceThreshold,
    });
    expect(await resolver.getSettings()).toMatchObject({ enabled: false, autoRouteAcceptEnabled: false });
    await expect(service.update({ enabled: true }, { actorId: 'admin' })).rejects.toThrow(AI_DEFERRED_MESSAGE);
    await expect(service.update({ autoRouteAccept: true }, { actorId: 'admin' })).rejects.toThrow(AI_DEFERRED_MESSAGE);
    expect(savedRow.enabled).toBe(true);
    expect(savedRow.autoRouteAccept).toBe(true);
    await expect(resolver.getApiKey()).resolves.toBeNull();
    expect(encryption.decrypt).not.toHaveBeenCalled();
  });

  it('rejects AI diagnostics without reading secrets or resolving any provider', async () => {
    const { prisma, encryption, resolver } = settingsFixture();
    const registry = { resolve: jest.fn() };
    const service = new AiSettingsService(prisma as never, encryption as never, {} as never, {} as never, resolver, registry as never);
    const discovery = new AiModelDiscoveryService(resolver, registry as never);

    expect(await service.test()).toMatchObject({ success: false, message: AI_DEFERRED_MESSAGE });
    expect(await discovery.discover({ provider: 'OPENAI', apiKey: 'request-key' })).toEqual({
      success: false,
      provider: 'OPENAI',
      models: [],
      message: AI_DEFERRED_MESSAGE,
    });
    expect(registry.resolve).not.toHaveBeenCalled();
    expect(encryption.decrypt).not.toHaveBeenCalled();
  });

  it('blocks all provider selection and direct runtime gateway methods', async () => {
    const { resolver } = settingsFixture();
    const registry = new LlmProviderRegistry({} as never, {} as never, {} as never);
    expect(registry.resolve('OPENAI')).toBeNull();
    expect(registry.resolve('ANTHROPIC')).toBeNull();
    expect(registry.resolve('GOOGLE_GEMINI')).toBeNull();

    const selection = jest.fn();
    const gateway = new DynamicLlmGateway(resolver, { resolve: selection } as never);
    await expect(gateway.classifyIntent({} as never)).rejects.toThrow(AI_DEFERRED_MESSAGE);
    await expect(gateway.draftReply({} as never)).rejects.toThrow(AI_DEFERRED_MESSAGE);
    expect(selection).not.toHaveBeenCalled();
  });

  it('does not enqueue, install recovery scans, process queued work or scan persisted routing', async () => {
    const queue = { add: jest.fn(), upsertJobScheduler: jest.fn() };
    const guardPrisma = {
      emailMessage: { findMany: jest.fn() },
      aiRoutingDecision: { findMany: jest.fn(), findUnique: jest.fn() },
    };
    const classifier = { classifyMessage: jest.fn() };
    const routing = { processOne: jest.fn(), processBatch: jest.fn() };
    const { resolver } = settingsFixture();
    const enqueue = new AiClassificationEnqueueService(queue as never, resolver);
    const routeEnqueue = new AiRoutingEnqueueService(queue as never);
    const worker = new AiClassificationWorker(classifier as never, enqueue, routing as never, guardPrisma as never, resolver);

    await enqueue.enqueueIfEnabled('message-1');
    await routeEnqueue.enqueue('decision-1');
    await new AiQueueService(queue as never).onModuleInit();
    for (const name of [AI_CLASSIFY_JOB, AI_RECOVERY_JOB, AI_ROUTE_JOB, AI_ROUTING_RECOVERY_JOB]) {
      await expect(worker.process({ name } as never)).resolves.toEqual({ disabled: true });
    }
    const directRouting = new AiRoutingService(guardPrisma as never, {} as never, {} as never, resolver);
    const directClassifier = new AiClassificationService(
      guardPrisma as never, resolver, {} as never, {} as never, {} as never, routeEnqueue, {} as never,
    );
    await expect(directClassifier.classifyMessage('message-1', true)).resolves.toBe('skipped_disabled');
    await expect(directRouting.processBatch()).resolves.toMatchObject({ candidates: 0 });
    await expect(directRouting.processOne('decision-1')).resolves.toBe('paused');
    expect(queue.add).not.toHaveBeenCalled();
    expect(queue.upsertJobScheduler).not.toHaveBeenCalled();
    expect(classifier.classifyMessage).not.toHaveBeenCalled();
    expect(routing.processOne).not.toHaveBeenCalled();
    expect(routing.processBatch).not.toHaveBeenCalled();
    expect(guardPrisma.emailMessage.findMany).not.toHaveBeenCalled();
    expect(guardPrisma.aiRoutingDecision.findMany).not.toHaveBeenCalled();
    expect(guardPrisma.aiRoutingDecision.findUnique).not.toHaveBeenCalled();
  });
});
