import { metrics } from '@lib/metrics';
import { remoteConfig } from '@lib/remoteConfig';
import { QueueingProviderAdapter } from '@providers/adapters/queueingAdapter';
import { ProviderAdapter } from '@providers/types';

const registry = new Map<string, ProviderAdapter>();
let initialized = false;

const ensureInitialized = async (): Promise<void> => {
  if (initialized) {
    return;
  }
  const providers = await remoteConfig.listProviders();
  providers
    .filter((provider) => provider.enabled)
    .forEach((provider) => {
      const adapter = new QueueingProviderAdapter(provider);
      registry.set(provider.name, adapter);
    });

  initialized = true;
};

export const getProvider = async (name: string): Promise<ProviderAdapter | undefined> => {
  await ensureInitialized();
  return registry.get(name);
};

export const listProviders = async (): Promise<string[]> => {
  await ensureInitialized();
  return [...registry.keys()];
};

export const reloadProviders = async (): Promise<void> => {
  registry.clear();
  initialized = false;
  await ensureInitialized();
  metrics.record('providers.reload', 1);
};
