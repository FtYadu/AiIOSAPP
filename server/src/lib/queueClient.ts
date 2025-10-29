import { metrics } from '@lib/metrics';
import { ProviderConfig } from '@lib/remoteConfig';
import { executeProviderJob } from '@workers/providerWorker';
import { ImageEditRequest } from '@providers/types';
import { appendArtifacts, updateJobStatus } from '@lib/jobRepository';
import { ensureMaskFromBoxes } from '@util/maskSynthesis';
import { dispatchJobWebhook } from '@lib/webhookDispatcher';
import amqp from 'amqplib';
import { runtimeConfig } from '@config/env';

export type QueuePayload = {
  jobId: string;
  provider: string;
  request: ImageEditRequest;
  config: ProviderConfig;
};

export interface QueueClient {
  enqueue(payload: QueuePayload): Promise<void>;
}

class InMemoryQueueClient implements QueueClient {
  async enqueue(payload: QueuePayload): Promise<void> {
    const requestWithMask = await ensureMaskFromBoxes(payload.request);
    const enrichedPayload = { ...payload, request: requestWithMask };

    metrics.record('queue.enqueue', 1, { provider: payload.provider });
    const timer = setTimeout(async () => {
      let jobError: string | null = null;
      try {
        const result = await executeProviderJob(
          {
            provider: enrichedPayload.provider,
            retries: 0,
            config: enrichedPayload.config,
            jobId: enrichedPayload.jobId
          },
          enrichedPayload.request
        );
        await appendArtifacts(enrichedPayload.jobId, result.artifacts ?? []);
        await updateJobStatus(enrichedPayload.jobId, result.status);
        if (result.status === 'succeeded' || result.status === 'failed') {
          await dispatchJobWebhook({
            jobId: enrichedPayload.jobId,
            status: result.status,
            artifacts: result.artifacts ?? [],
            error: null
          });
        }
        metrics.record('queue.job.success', 1, { provider: enrichedPayload.provider });
      } catch (error) {
        jobError = error instanceof Error ? error.message : 'Unknown error';
        metrics.record('queue.job.failure', 1, { provider: enrichedPayload.provider });
        await updateJobStatus(enrichedPayload.jobId, 'failed', jobError);
        await dispatchJobWebhook({
          jobId: enrichedPayload.jobId,
          status: 'failed',
          artifacts: [],
          error: jobError
        });
      }
    }, 10);
    timer.unref?.();
  }
}

class RabbitQueueClient implements QueueClient {
  private channelPromise: Promise<amqp.Channel> | null = null;

  private async getChannel(): Promise<amqp.Channel> {
    if (!this.channelPromise) {
      const promise = (async () => {
        const connection = await amqp.connect(runtimeConfig.rabbitUrl!);
        const channel = await connection.createChannel();
        await channel.assertQueue(runtimeConfig.rabbitQueue, { durable: true });
        return channel;
      })();

      this.channelPromise = promise;
    }

    return this.channelPromise;
  }

  async enqueue(payload: QueuePayload): Promise<void> {
    const requestWithMask = await ensureMaskFromBoxes(payload.request);
    const channel = await this.getChannel();
    const buffer = Buffer.from(
      JSON.stringify({
        ...payload,
        request: requestWithMask
      })
    );
    channel.sendToQueue(runtimeConfig.rabbitQueue, buffer, { persistent: true });
    metrics.record('queue.enqueue', 1, { provider: payload.provider, transport: 'rabbitmq' });
  }
}

let selectedQueueClient: QueueClient;

if (runtimeConfig.rabbitUrl) {
  selectedQueueClient = new RabbitQueueClient();
} else {
  selectedQueueClient = new InMemoryQueueClient();
}

export const queueClient: QueueClient = selectedQueueClient;
