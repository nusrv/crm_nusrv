import { AnthropicProviderAdapter } from './anthropic-provider-adapter';
import { GoogleGeminiProviderAdapter } from './google-gemini-provider-adapter';
import { LlmProviderRegistry } from './llm-provider-registry.service';
import { OpenAiProviderAdapter } from './openai-provider-adapter';

describe('LlmProviderRegistry (provider-neutral dispatcher)', () => {
  it('P1 — OPENAI resolves only the OpenAI adapter', () => {
    const openai = new OpenAiProviderAdapter();
    const registry = new LlmProviderRegistry(openai, new AnthropicProviderAdapter(), new GoogleGeminiProviderAdapter());
    expect(registry.resolve('OPENAI')).toBe(openai);
  });

  it('P2 — ANTHROPIC resolves only the Anthropic adapter', () => {
    const anthropic = new AnthropicProviderAdapter();
    const registry = new LlmProviderRegistry(new OpenAiProviderAdapter(), anthropic, new GoogleGeminiProviderAdapter());
    expect(registry.resolve('ANTHROPIC')).toBe(anthropic);
  });

  it('P3 — GOOGLE_GEMINI resolves only the Gemini adapter', () => {
    const gemini = new GoogleGeminiProviderAdapter();
    const registry = new LlmProviderRegistry(new OpenAiProviderAdapter(), new AnthropicProviderAdapter(), gemini);
    expect(registry.resolve('GOOGLE_GEMINI')).toBe(gemini);
  });

  it('P6 — an unknown/unsupported provider string fails closed: returns null, never a default adapter', () => {
    const registry = new LlmProviderRegistry(new OpenAiProviderAdapter(), new AnthropicProviderAdapter(), new GoogleGeminiProviderAdapter());
    expect(registry.resolve('mock')).toBeNull();
    expect(registry.resolve('')).toBeNull();
    expect(registry.resolve('openai')).toBeNull(); // case-sensitive — canonical IDs are upper-snake only.
  });
});
