import { runtimeConfig } from '@config/env';

export type ProviderSafetyLevel = 'strict' | 'balanced' | 'uncensored';

export type ProviderConfig = {
  name: string;
  endpoint: string;
  modelId: string;
  safetyLevel: ProviderSafetyLevel;
  enabled: boolean;
  supportsBoxes: boolean;
  supportsUpscale: boolean;
  guidanceRange: [number, number];
};

const fallbackConfigs: ProviderConfig[] = [
  {
    name: 'reimagine',
    endpoint: 'https://api.reimagine.local/v1',
    modelId: 'reimagine-edit-latest',
    safetyLevel: 'uncensored',
    enabled: true,
    supportsBoxes: true,
    supportsUpscale: true,
    guidanceRange: [0, 1]
  },
  {
    name: 'openai',
    endpoint: 'https://api.openai.com/v1',
    modelId: 'gpt-image-edit-1',
    safetyLevel: 'balanced',
    enabled: true,
    supportsBoxes: true,
    supportsUpscale: false,
    guidanceRange: [0, 1]
  },
  {
    name: 'gemini',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta',
    modelId: 'gemini-image-edit-1',
    safetyLevel: 'strict',
    enabled: true,
    supportsBoxes: false,
    supportsUpscale: false,
    guidanceRange: [0, 1]
  },
  {
    name: 'seedream',
    endpoint: 'https://api.seedream.ai/v1',
    modelId: 'seedream-edit-4.0',
    safetyLevel: 'balanced',
    enabled: true,
    supportsBoxes: true,
    supportsUpscale: true,
    guidanceRange: [0, 1]
  }
];

export const remoteConfig = {
  async listProviders(): Promise<ProviderConfig[]> {
    if (!runtimeConfig.supabaseUrl || !runtimeConfig.supabaseServiceRoleKey) {
      return fallbackConfigs;
    }

    // TODO: Replace with Supabase query; fallback used during local dev.
    return fallbackConfigs;
  },

  async getProvider(name: string): Promise<ProviderConfig | undefined> {
    const providers = await this.listProviders();
    return providers.find((provider) => provider.name === name);
  }
};
