import { metrics } from '@lib/metrics';
import { ProviderConfig } from '@lib/remoteConfig';
import { executeProviderJob } from '@workers/providerWorker';
import { ImageEditRequest } from '@providers/types';
import { appendArtifacts, updateJobStatus } from '@lib/jobRepository';
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
    metrics.record('queue.enqueue', 1, { provider: payload.provider });
    const timer = setTimeout(async () => {
      try {
        const result = await executeProviderJob(
          { provider: payload.provider, retries: 0, config: payload.config, jobId: payload.jobId },
          payload.request
        );
        await appendArtifacts(payload.jobId, result.artifacts ?? []);
        await updateJobStatus(payload.jobId, result.status);
        metrics.record('queue.job.success', 1, { provider: payload.provider });
      } catch (error) {
        metrics.record('queue.job.failure', 1, { provider: payload.provider });
        await updateJobStatus(
          payload.jobId,
          'failed',
          error instanceof Error ? error.message : 'Unknown error'
        );
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
    const channel = await this.getChannel();
    const buffer = Buffer.from(JSON.stringify(payload));
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
