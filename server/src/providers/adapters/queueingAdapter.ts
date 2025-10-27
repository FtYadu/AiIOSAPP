import { metrics } from '@lib/metrics';
import { ProviderConfig } from '@lib/remoteConfig';
import { queueClient } from '@lib/queueClient';
import { createJob as createDbJob, findJobWithOutputs } from '@lib/jobRepository';
import {
  ImageEditRequest,
  ImageEditResult,
  ProviderAdapter,
  ProviderJob,
  EnqueueOptions
} from '@providers/types';

export class QueueingProviderAdapter implements ProviderAdapter {
  public readonly name: string;
  private readonly config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
    this.name = config.name;
  }

  async enqueueEdit(request: ImageEditRequest, options: EnqueueOptions = {}): Promise<ProviderJob> {
    if (!options.userId) {
      throw new Error('userId is required to enqueue a job');
    }

    const jobRow = await createDbJob({
      userId: options.userId,
      provider: this.name,
      prompt: options.prompt ?? request.prompt,
      strength: request.strength,
      guidance: request.guidance,
      seed: request.seed,
      size: request.size ? `${request.size.w}x${request.size.h}` : undefined,
      outputFormat: request.format ?? 'png',
      n: 1,
      initImageUrl: request.baseImage ?? null,
      maskUrl: request.maskImage ?? null,
      metadata: options.metadata,
      webhookUrl: options.webhookUrl ?? null,
      idempotencyKey: options.idempotencyKey ?? null
    });

    metrics.record('providers.enqueue', 1, { provider: this.name });

    await queueClient.enqueue({
      jobId: jobRow.id,
      provider: this.name,
      request,
      config: this.config
    });

    return {
      jobId: jobRow.id,
      provider: this.name,
      status: jobRow.status,
      createdAt: jobRow.created_at,
      updatedAt: jobRow.updated_at
    };
  }

  async fetchResult(jobId: string): Promise<ImageEditResult> {
    const record = await findJobWithOutputs(jobId);
    if (!record) {
      throw new Error(`Job ${jobId} not found`);
    }

    const artifacts = record.outputs.map((asset) => ({
      url: asset.public_url ?? asset.storage_path,
      mime: asset.mime ?? 'image/png',
      sha256: asset.sha256 ?? undefined,
      width: asset.width ?? undefined,
      height: asset.height ?? undefined
    }));

    return {
      status: record.job.status,
      artifacts,
      providerMeta: {
        provider: record.job.provider
      }
    };
  }
}
