/**
 * LLM Provider Registry - Single source of truth for all supported providers.
 *
 * TO ADD A NEW PROVIDER:
 * 1. Add entry to PROVIDER_REGISTRY below
 * 2. If it uses OpenAI-compatible API, set `apiStyle: "openai"` (no code changes needed)
 * 3. If it has a custom API, add handler in llm-gateway.ts
 *
 * That's it! Frontend will auto-detect from this registry.
 */

export interface ProviderConfig {
  /** Display name shown in UI */
  label: string;
  /** Default API endpoint */
  defaultEndpoint: string;
  /** Default model to use */
  defaultModel: string;
  /** Whether API key is required */
  requiresApiKey: boolean;
  /** API style: "openai" = OpenAI-compatible, "custom" = needs custom handler */
  apiStyle: "openai" | "ollama" | "anthropic" | "gemini" | "custom";
  /** Optional: Available models for this provider */
  availableModels?: string[];
  /** Optional: Description/notes */
  description?: string;
}

/**
 * Central registry of all supported LLM providers.
 * Add new providers here - they'll automatically appear in the UI.
 */
export const PROVIDER_REGISTRY: Record<string, ProviderConfig> = {
  ollama: {
    label: "Ollama (local)",
    defaultEndpoint: "http://localhost:11434",
    defaultModel: "llama3",
    requiresApiKey: false,
    apiStyle: "ollama",
    description: "Run open-source models locally",
  },

  openai: {
    label: "OpenAI",
    defaultEndpoint: "https://api.openai.com/v1",
    defaultModel: "gpt-4o",
    requiresApiKey: true,
    apiStyle: "openai",
    availableModels: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"],
  },

  anthropic: {
    label: "Anthropic Claude",
    defaultEndpoint: "https://api.anthropic.com/v1",
    defaultModel: "claude-sonnet-4-20250514",
    requiresApiKey: true,
    apiStyle: "anthropic",
    availableModels: ["claude-sonnet-4-20250514", "claude-3-5-sonnet-20241022", "claude-3-haiku-20240307"],
  },

  gemini: {
    label: "Google Gemini",
    defaultEndpoint: "https://generativelanguage.googleapis.com/v1beta",
    defaultModel: "gemini-1.5-flash",
    requiresApiKey: true,
    apiStyle: "gemini",
    availableModels: ["gemini-1.5-flash", "gemini-1.5-pro", "gemini-2.0-flash"],
  },

  cerebras: {
    label: "Cerebras",
    defaultEndpoint: "https://api.cerebras.ai/v1",
    defaultModel: "qwen-3-235b-a22b-instruct-2507",  // Qwen 235B - BEST model
    requiresApiKey: true,
    apiStyle: "openai", // Cerebras uses OpenAI-compatible API
    availableModels: [
      "qwen-3-235b-a22b-instruct-2507",  // 235B params - BEST, follows instructions perfectly
      "llama3.1-8b",                      // 8B params - Fast but weak, hallucinates
    ],
    description: "Ultra-fast inference with Qwen-3-235B! 30 req/min, 30k tokens/min - EXCELLENT PERFORMANCE",
  },

  groq: {
    label: "Groq",
    defaultEndpoint: "https://api.groq.com/openai/v1",
    defaultModel: "qwen/qwen3-32b",
    requiresApiKey: true,
    apiStyle: "openai", // Groq uses OpenAI-compatible API
    availableModels: ["qwen/qwen3-32b", "llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768"],
    description: "Fast inference with Groq LPU",
  },

  together: {
    label: "Together AI",
    defaultEndpoint: "https://api.together.xyz/v1",
    defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    requiresApiKey: true,
    apiStyle: "openai", // Together uses OpenAI-compatible API
    availableModels: [
      "meta-llama/Llama-3.3-70B-Instruct-Turbo",
      "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo",
      "mistralai/Mixtral-8x7B-Instruct-v0.1",
    ],
  },

  openrouter: {
    label: "OpenRouter",
    defaultEndpoint: "https://openrouter.ai/api/v1",
    defaultModel: "nvidia/nemotron-3-ultra-550b-a55b:free",
    requiresApiKey: true,
    apiStyle: "openai", // OpenRouter uses OpenAI-compatible API
    availableModels: [
      "nvidia/nemotron-3-ultra-550b-a55b:free",
      "poolside/laguna-s-2.1:free",
      "nvidia/nemotron-3-super-120b-a12b:free",
      "cohere/north-mini-code:free",
      "google/gemma-4-31b-it:free",
      "openai/gpt-oss-20b:free",
    ],
    description: "OpenRouter gateway with pinned free reasoning and coding models",
  },

  "opencode-zen": {
    label: "OpenCode Zen",
    defaultEndpoint: "https://opencode.ai/zen/v1",
    defaultModel: "big-pickle",
    requiresApiKey: true,
    apiStyle: "openai", // OpenCode Zen provides OpenAI-compatible chat/completions
    availableModels: ["big-pickle"],
    description: "OpenCode Zen gateway (OpenAI-compatible)",
  },

  nvidia: {
    label: "NVIDIA NIM",
    defaultEndpoint: "https://integrate.api.nvidia.com/v1",
    defaultModel: "nvidia/nemotron-3-ultra-550b-a55b",
    requiresApiKey: true,
    apiStyle: "openai",
    availableModels: [
      "nvidia/nemotron-3-ultra-550b-a55b",
      "nvidia/nemotron-3-super-120b-a12b",
      "nvidia/nemotron-3-nano-30b-a3b",
      "nvidia/llama-3.1-nemotron-ultra-253b-v1",
      "nvidia/llama-3.3-nemotron-super-49b-v1.5",
    ],
    description: "NVIDIA-hosted Nemotron reasoning models; Ultra 550B is the strongest tier",
  },

  deepseek: {
    label: "DeepSeek",
    defaultEndpoint: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
    requiresApiKey: true,
    apiStyle: "openai", // DeepSeek uses OpenAI-compatible API
    availableModels: ["deepseek-chat", "deepseek-coder"],
  },

  custom: {
    label: "Custom (OpenAI-compatible)",
    defaultEndpoint: "",
    defaultModel: "model-name",
    requiresApiKey: false,
    apiStyle: "openai",
    description: "Any OpenAI-compatible endpoint",
  },
};

/** Get list of valid provider type strings */
export function getValidProviderTypes(): string[] {
  return Object.keys(PROVIDER_REGISTRY);
}

/** Get provider config by type */
export function getProviderConfig(type: string): ProviderConfig | undefined {
  return PROVIDER_REGISTRY[type];
}

/** Check if provider type is valid */
export function isValidProviderType(type: string): boolean {
  return type in PROVIDER_REGISTRY;
}

/** Get API style for a provider (used to determine which handler to use) */
export function getApiStyle(type: string): ProviderConfig["apiStyle"] {
  return PROVIDER_REGISTRY[type]?.apiStyle ?? "openai";
}

/** Export registry as array for frontend consumption */
export function getProviderList() {
  return Object.entries(PROVIDER_REGISTRY).map(([value, config]) => ({
    value,
    label: config.label,
    defaultEndpoint: config.defaultEndpoint,
    defaultModel: config.defaultModel,
    requiresApiKey: config.requiresApiKey,
    availableModels: config.availableModels,
    description: config.description,
  }));
}
