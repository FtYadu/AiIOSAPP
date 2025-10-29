import amqp from 'amqplib';

import { runtimeConfig } from '@config/env';
import { metrics } from '@lib/metrics';
import { appendArtifacts, updateJobStatus } from '@lib/jobRepository';
import { executeProviderJob } from './providerWorker';
import { QueuePayload } from '@lib/queueClient';
import { createLogger } from '@lib/logger';
import { dispatchWebhook } from '@lib/webhooks';
import { deriveErrorTag } from '@util/errors';
import { computeBackoffDelay, sleep } from '@util/backoff';

export const startRabbitWorker = async (): Promise<void> => {
  if (!runtimeConfig.rabbitUrl) {
    throw new Error('RABBITMQ_URL is not defined; cannot start worker.');
  }

  const workerLogger = createLogger({ module: 'rabbitWorker' });

  const connection = await amqp.connect(runtimeConfig.rabbitUrl);
  const channel = await connection.createChannel();
  await channel.assertQueue(runtimeConfig.rabbitQueue, {
    durable: true,
    deadLetterExchange: '',
    deadLetterRoutingKey: runtimeConfig.rabbitDeadLetterQueue
  });
  await channel.assertQueue(runtimeConfig.rabbitDeadLetterQueue, { durable: true });
  channel.prefetch(1);

  channel.consume(runtimeConfig.rabbitQueue, async (msg) => {
    if (!msg) {
      return;
    }

    let payload: QueuePayload | null = null;
    try {
      payload = JSON.parse(msg.content.toString()) as QueuePayload;
      workerLogger.info(
        { jobId: payload.jobId, provider: payload.provider, attempt: payload.attempt },
        'received job from queue'
      );
      const result = await executeProviderJob(
        { provider: payload.provider, retries: payload.attempt, config: payload.config, jobId: payload.jobId },
        payload.request
      );

      await appendArtifacts(payload.jobId, result.artifacts ?? []);
      await updateJobStatus(payload.jobId, result.status);
      metrics.record('queue.job.success', 1, { provider: payload.provider, transport: 'rabbitmq' });
      metrics.observeQueueLatency(payload.provider, 'rabbitmq', Date.now() - payload.enqueuedAt, 'success');
      workerLogger.info(
        { jobId: payload.jobId, provider: payload.provider, attempt: payload.attempt },
        'job completed successfully'
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

      channel.ack(msg);
    } catch (error) {
      if (payload) {
        workerLogger.error(
          { jobId: payload.jobId, provider: payload.provider, attempt: payload.attempt, err: error },
          'job execution failed'
        );
        const errorTag = deriveErrorTag(error);
        metrics.record('queue.job.failure', 1, {
          provider: payload.provider,
          transport: 'rabbitmq',
          error_tag: errorTag
        });
        metrics.observeQueueLatency(payload.provider, 'rabbitmq', Date.now() - payload.enqueuedAt, 'failure');

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
          const deadLetterPayload = {
            ...payload,
            attempt: nextAttempt
          };
          channel.ack(msg);
          channel.sendToQueue(runtimeConfig.rabbitDeadLetterQueue, Buffer.from(JSON.stringify(deadLetterPayload)), {
            persistent: true,
            headers: {
              attempt: deadLetterPayload.attempt
            }
          });
        } else {
          channel.ack(msg);
          const delayMs = computeBackoffDelay(payload.attempt);
          workerLogger.warn(
            { jobId: payload.jobId, provider: payload.provider, delayMs, nextAttempt },
            'scheduling retry for job'
          );
          await sleep(delayMs);
          const retryPayload: QueuePayload = { ...payload, attempt: nextAttempt };
          channel.sendToQueue(runtimeConfig.rabbitQueue, Buffer.from(JSON.stringify(retryPayload)), {
            persistent: true,
            headers: {
              attempt: retryPayload.attempt
            }
          });
        }
      } else {
        metrics.record('queue.job.failure', 1, {
          provider: 'unknown',
          transport: 'rabbitmq',
          error_tag: 'parse_error'
        });
        workerLogger.error({ err: error }, 'failed to parse queue payload');
        channel.nack(msg, false, false);
      }
    }
  });

  process.on('SIGINT', async () => {
    await channel.close();
    await connection.close();
    process.exit(0);
  });
};

if (process.argv[1] && process.argv[1].endsWith('rabbitWorker.ts')) {
  startRabbitWorker().catch((error) => {
    // eslint-disable-next-line no-console
    console.error('[worker] failed to start RabbitMQ worker', error);
    process.exit(1);
  });
}
