import { ImageEditRequest, ImageEditResult } from '@providers/types';
import { ProviderConfig } from '@lib/remoteConfig';
import { resolveExecutor } from '@providers/executors/registry';
import { ensureMaskFromBoxes } from '@util/maskSynthesis';

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
  const requestWithMask = await ensureMaskFromBoxes(request);
  const result = await executor(context.jobId, requestWithMask, context.config);
  return {
    ...result,
    providerMeta: {
      ...result.providerMeta,
      retries: context.retries,
      config: context.config
    }
  };
};
