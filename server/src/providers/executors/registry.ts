import { ImageEditRequest, ImageEditResult } from '@providers/types';
import { ProviderConfig } from '@lib/remoteConfig';

import { buildStubResult } from './helpers';
import { handleGeminiEdit } from './geminiExecutor';
import { handleOpenAIEdit } from './openaiExecutor';
import { handleReimagineEdit } from './reimagineExecutor';
import { handleSeedreamEdit } from './seedreamExecutor';

type Executor = (jobId: string, request: ImageEditRequest, config: ProviderConfig) => Promise<ImageEditResult>;

const executors: Record<string, Executor> = {
  openai: handleOpenAIEdit,
  reimagine: handleReimagineEdit,
  gemini: handleGeminiEdit,
  seedream: handleSeedreamEdit
};

const stubExecutor: Executor = async (jobId, request, config) =>
  buildStubResult(config.name, request, {
    providerMeta: {
      message: 'No executor registered; returning stub response'
    }
  });

export const resolveExecutor = (provider: string): Executor => executors[provider] ?? stubExecutor;

export const registerExecutor = (provider: string, executor: Executor): void => {
  executors[provider] = executor;
};
