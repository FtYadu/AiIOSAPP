import { ImageEditRequest, ImageEditResult } from '@providers/types';
import { ProviderConfig } from '@lib/remoteConfig';
import { resolveExecutor } from '@providers/executors/registry';
import { createLogger } from '@lib/logger';

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
  const log = createLogger({
    module: 'providerWorker',
    provider: context.provider,
    jobId: context.jobId,
    retries: context.retries
  });
  log.info('starting provider executor');
  const start = Date.now();
  const result = await executor(context.jobId, request, context.config);
  const durationMs = Date.now() - start;
  log.info({ durationMs, status: result.status }, 'provider executor completed');
  return {
    ...result,
    providerMeta: {
      ...result.providerMeta,
      retries: context.retries,
      config: context.config
    }
  };
};
