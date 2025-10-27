import amqp from 'amqplib';

import { runtimeConfig } from '@config/env';
import { metrics } from '@lib/metrics';
import { appendArtifacts, updateJobStatus } from '@lib/jobRepository';
import { executeProviderJob } from './providerWorker';
import { QueuePayload } from '@lib/queueClient';

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

    try {
      const payload = JSON.parse(msg.content.toString()) as QueuePayload;

      const result = await executeProviderJob(
        { provider: payload.provider, retries: 0, config: payload.config, jobId: payload.jobId },
        payload.request
      );

      await appendArtifacts(payload.jobId, result.artifacts ?? []);
      await updateJobStatus(payload.jobId, result.status);
      metrics.record('queue.job.success', 1, { provider: payload.provider, transport: 'rabbitmq' });

      channel.ack(msg);
    } catch (error) {
      metrics.record('queue.job.failure', 1, {
        provider: 'unknown',
        transport: 'rabbitmq'
      });
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
