import { ImageEditRequest, ImageEditResult } from '@providers/types';
import { ProviderConfig } from '@lib/remoteConfig';
import { resolveExecutor } from '@providers/executors/registry';

export type WorkerContext = {
  provider: string;
  retries: number;
  config: ProviderConfig;
  jobId: string;
};

export const executeProviderJob = async (
  context: WorkerContext,
  request: ImageEditRequest
): Promise<ImageEditResult> => {
  const executor = resolveExecutor(context.provider);
  const result = await executor(context.jobId, request, context.config);
  return {
    ...result,
    providerMeta: {
      ...result.providerMeta,
      retries: context.retries,
      config: context.config
    }
  };
};
