import amqp from 'amqplib';

import { runtimeConfig } from '@config/env';
import { metrics } from '@lib/metrics';
import { appendArtifacts, updateJobStatus } from '@lib/jobRepository';
import { executeProviderJob } from './providerWorker';
import { QueuePayload } from '@lib/queueClient';
import { ensureMaskFromBoxes } from '@util/maskSynthesis';
import { dispatchJobWebhook } from '@lib/webhookDispatcher';

export const startRabbitWorker = async (): Promise<void> => {
  if (!runtimeConfig.rabbitUrl) {
    throw new Error('RABBITMQ_URL is not defined; cannot start worker.');
  }

  const connection = await amqp.connect(runtimeConfig.rabbitUrl);
  const channel = await connection.createChannel();
  await channel.assertQueue(runtimeConfig.rabbitQueue, { durable: true });
  channel.prefetch(1);

  channel.consume(runtimeConfig.rabbitQueue, async (msg) => {
    if (!msg) {
      return;
    }

    let payload: QueuePayload | null = null;
    try {
      payload = JSON.parse(msg.content.toString()) as QueuePayload;
      const requestWithMask = await ensureMaskFromBoxes(payload.request);

      const result = await executeProviderJob(
        { provider: payload.provider, retries: 0, config: payload.config, jobId: payload.jobId },
        requestWithMask
      );

      await appendArtifacts(payload.jobId, result.artifacts ?? []);
      await updateJobStatus(payload.jobId, result.status);
      if (result.status === 'succeeded' || result.status === 'failed') {
        await dispatchJobWebhook({
          jobId: payload.jobId,
          status: result.status,
          artifacts: result.artifacts ?? [],
          error: null
        });
      }
      metrics.record('queue.job.success', 1, { provider: payload.provider, transport: 'rabbitmq' });

      channel.ack(msg);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      metrics.record('queue.job.failure', 1, {
        provider: payload?.provider ?? 'unknown',
        transport: 'rabbitmq'
      });
      if (payload) {
        await updateJobStatus(payload.jobId, 'failed', message).catch(() => undefined);
        await dispatchJobWebhook({
          jobId: payload.jobId,
          status: 'failed',
          artifacts: [],
          error: message
        }).catch(() => undefined);
      }
      channel.nack(msg, false, false);
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
