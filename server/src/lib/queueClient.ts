import amqp from 'amqplib';

import { metrics } from '@lib/metrics';
import { ProviderConfig } from '@lib/remoteConfig';
import { executeProviderJob } from '@workers/providerWorker';
import { ImageEditRequest } from '@providers/types';
import { appendArtifacts, updateJobStatus } from '@lib/jobRepository';
import { runtimeConfig } from '@config/env';
import { createLogger } from '@lib/logger';
import { dispatchWebhook } from '@lib/webhooks';
import { deriveErrorTag } from '@util/errors';
import { computeBackoffDelay, sleep } from '@util/backoff';

type TransportName = 'in-memory' | 'rabbitmq';

const queueLogger = createLogger({ module: 'queueClient' });

export type QueuePayload = {
  jobId: string;
  provider: string;
  request: ImageEditRequest;
  config: ProviderConfig;
  webhookUrl?: string | null;
  enqueuedAt: number;
  attempt: number;
};

export interface QueueClient {
  enqueue(payload: QueuePayload): Promise<void>;
}

class InMemoryQueueClient implements QueueClient {
  async enqueue(payload: QueuePayload): Promise<void> {
    metrics.record('queue.enqueue', 1, { provider: payload.provider, transport: 'in-memory' });
    queueLogger.info({ jobId: payload.jobId, provider: payload.provider }, 'job enqueued (memory)');
    this.scheduleAttempt(payload);
  }

  private scheduleAttempt(payload: QueuePayload): void {
    if (payload.attempt === 0) {
      queueLogger.debug({ jobId: payload.jobId }, 'processing job immediately');
      void this.process(payload);
      return;
    }
    const delay = computeBackoffDelay(payload.attempt - 1);
    const timer = setTimeout(() => {
      void this.process(payload);
    }, delay);
    timer.unref?.();
  }

  private async process(payload: QueuePayload): Promise<void> {
    try {
      queueLogger.info(
        { jobId: payload.jobId, provider: payload.provider, attempt: payload.attempt },
        'starting job execution'
      );
      const result = await executeProviderJob(
        { provider: payload.provider, retries: payload.attempt, config: payload.config, jobId: payload.jobId },
        payload.request
      );
      await appendArtifacts(payload.jobId, result.artifacts ?? []);
      await updateJobStatus(payload.jobId, result.status);
      metrics.record('queue.job.success', 1, { provider: payload.provider, transport: 'in-memory' });
      metrics.observeQueueLatency(payload.provider, 'in-memory', Date.now() - payload.enqueuedAt, 'success');
      queueLogger.info(
        { jobId: payload.jobId, provider: payload.provider, attempt: payload.attempt },
        'job execution completed'
      );
      if (payload.webhookUrl) {
        await dispatchWebhook({
          jobId: payload.jobId,
          provider: payload.provider,
          status: result.status,
          webhookUrl: payload.webhookUrl,
          attempt: payload.attempt
        });
      }
    } catch (error) {
      queueLogger.error(
        { jobId: payload.jobId, provider: payload.provider, attempt: payload.attempt, err: error },
        'job execution failed'
      );
      metrics.record('queue.job.failure', 1, {
        provider: payload.provider,
        transport: 'in-memory',
        error_tag: deriveErrorTag(error)
      });
      metrics.observeQueueLatency(payload.provider, 'in-memory', Date.now() - payload.enqueuedAt, 'failure');
      const nextAttempt = payload.attempt + 1;
      if (nextAttempt > runtimeConfig.queueMaxRetries) {
        await updateJobStatus(
          payload.jobId,
          'failed',
          error instanceof Error ? error.message : 'Unknown error'
        );
        if (payload.webhookUrl) {
          await dispatchWebhook({
            jobId: payload.jobId,
            provider: payload.provider,
            status: 'failed',
            webhookUrl: payload.webhookUrl,
            attempt: payload.attempt,
            error
          });
        }
        return;
      }

      this.scheduleAttempt({ ...payload, attempt: nextAttempt });
    }
  }
}

type ManagedConnection = amqp.Connection & amqp.ChannelModel;

class RabbitQueueClient implements QueueClient {
  private channelPromise: Promise<amqp.Channel> | null = null;
  private readonly transport: TransportName = 'rabbitmq';
  private readonly log = createLogger({ module: 'queueClient.rabbit' });

  private async getChannel(): Promise<amqp.Channel> {
    if (!this.channelPromise) {
      const promise = (async () => {
        const connection = await this.connectWithRetry();
        const channel = await connection.createChannel();
        await channel.assertQueue(runtimeConfig.rabbitQueue, {
          durable: true,
          deadLetterExchange: '',
          deadLetterRoutingKey: runtimeConfig.rabbitDeadLetterQueue
        });
        await channel.assertQueue(runtimeConfig.rabbitDeadLetterQueue, { durable: true });
        return channel;
      })();

      this.channelPromise = promise;
    }

    return this.channelPromise;
  }

  private async connectWithRetry(): Promise<ManagedConnection> {
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        this.log.info({ attempt }, 'connecting to RabbitMQ');
        const connection = (await amqp.connect(runtimeConfig.rabbitUrl!)) as ManagedConnection;
        connection.on('error', (error) => {
          this.log.error({ err: error }, 'RabbitMQ connection error');
          this.channelPromise = null;
        });
        connection.on('close', () => {
          this.log.warn('RabbitMQ connection closed');
          this.channelPromise = null;
        });
        return connection;
      } catch (error) {
        attempt += 1;
        this.log.error({ err: error, attempt }, 'RabbitMQ connection attempt failed');
        if (attempt > runtimeConfig.queueMaxRetries) {
          throw error;
        }
        await sleep(computeBackoffDelay(Math.max(attempt - 1, 0)));
      }
    }
  }

  async enqueue(payload: QueuePayload): Promise<void> {
    const channel = await this.getChannel();
    const buffer = Buffer.from(JSON.stringify(payload));
    channel.sendToQueue(runtimeConfig.rabbitQueue, buffer, {
      persistent: true,
      headers: {
        attempt: payload.attempt
      }
    });
    metrics.record('queue.enqueue', 1, { provider: payload.provider, transport: this.transport });
    this.log.info({ jobId: payload.jobId, provider: payload.provider }, 'job enqueued (rabbitmq)');
  }
}

let selectedQueueClient: QueueClient;

if (runtimeConfig.rabbitUrl) {
  selectedQueueClient = new RabbitQueueClient();
} else {
  selectedQueueClient = new InMemoryQueueClient();
}

export const queueClient: QueueClient = selectedQueueClient;
