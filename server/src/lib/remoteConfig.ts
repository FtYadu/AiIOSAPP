import { createClient, SupabaseClient } from '@supabase/supabase-js';

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

const CACHE_TTL_MS = 5 * 60 * 1000;

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

type ProviderRouteRow = {
  provider: string;
  endpoint_url: string;
  model_id: string;
  safety_level: ProviderSafetyLevel | null;
  enabled: boolean | null;
  supports_boxes: boolean | null;
  supports_upscale: boolean | null;
  guidance_min: number | null;
  guidance_max: number | null;
};

let supabaseClient: SupabaseClient | null = null;
let cachedProviders: ProviderConfig[] | null = null;
let cacheExpiresAt = 0;

const getSupabaseClient = (): SupabaseClient | null => {
  if (!runtimeConfig.supabaseUrl || !runtimeConfig.supabaseServiceRoleKey) {
    return null;
  }

  if (!supabaseClient) {
    supabaseClient = createClient(runtimeConfig.supabaseUrl, runtimeConfig.supabaseServiceRoleKey, {
      auth: { persistSession: false },
      db: { schema: 'public' }
    });
  }

  return supabaseClient;
};

const mapRowToConfig = (row: ProviderRouteRow): ProviderConfig | null => {
  if (!row.provider || !row.endpoint_url || !row.model_id) {
    return null;
  }

  const guidanceMin = Number.isFinite(row.guidance_min) ? (row.guidance_min as number) : 0;
  const guidanceMax = Number.isFinite(row.guidance_max) ? (row.guidance_max as number) : 1;
  const guidanceRange: [number, number] = [guidanceMin, guidanceMax];

  return {
    name: row.provider,
    endpoint: row.endpoint_url,
    modelId: row.model_id,
    safetyLevel: row.safety_level ?? 'balanced',
    enabled: row.enabled ?? true,
    supportsBoxes: row.supports_boxes ?? false,
    supportsUpscale: row.supports_upscale ?? false,
    guidanceRange
  };
};

const fetchRemoteProviders = async (): Promise<ProviderConfig[] | null> => {
  const client = getSupabaseClient();
  if (!client) {
    return null;
  }

  try {
    const { data, error } = await client
      .from(runtimeConfig.remoteConfigTable)
      .select('*')
      .eq('enabled', true);

    if (error) {
      throw error;
    }

    if (!data) {
      return [];
    }

    return (data as ProviderRouteRow[])
      .filter((row) => row.enabled)
      .map(mapRowToConfig)
      .filter((config): config is ProviderConfig => config !== null);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('Failed to load remote provider config, falling back to defaults', err);
    return null;
  }
};

export const remoteConfig = {
  async listProviders(): Promise<ProviderConfig[]> {
    const now = Date.now();
    if (cachedProviders && now < cacheExpiresAt) {
      return cachedProviders;
    }

    const remoteProviders = await fetchRemoteProviders();
    if (remoteProviders !== null) {
      cachedProviders = remoteProviders;
    } else {
      cachedProviders = fallbackConfigs;
    }

    cacheExpiresAt = now + CACHE_TTL_MS;
    return cachedProviders;
  },

  async getProvider(name: string): Promise<ProviderConfig | undefined> {
    const providers = await this.listProviders();
    return providers.find((provider) => provider.name === name);
  },

  invalidateCache(): void {
    cachedProviders = null;
    cacheExpiresAt = 0;
  }
};
