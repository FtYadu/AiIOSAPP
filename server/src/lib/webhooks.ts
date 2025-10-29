import { fetch } from 'undici';

import { createLogger } from '@lib/logger';
import { metrics } from '@lib/metrics';
import { computeBackoffDelay, sleep } from '@util/backoff';

type DispatchWebhookParams = {
  jobId: string;
  provider: string;
  status: string;
  webhookUrl: string;
  attempt: number;
  error?: unknown;
};

const webhookLogger = createLogger({ module: 'webhook.dispatcher' });
const MAX_DISPATCH_ATTEMPTS = 3;

const serializeError = (error: unknown): Record<string, unknown> | undefined => {
  if (!error) {
    return undefined;
  }
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack
    };
  }
  if (typeof error === 'string') {
    return { message: error };
  }
  return { message: 'unknown error', detail: error as Record<string, unknown> };
};

export const dispatchWebhook = async ({
  jobId,
  provider,
  status,
  webhookUrl,
  attempt,
  error
}: DispatchWebhookParams): Promise<void> => {
  webhookLogger.info({ jobId, provider, status, attempt }, 'dispatching webhook');

  for (let dispatchAttempt = 1; dispatchAttempt <= MAX_DISPATCH_ATTEMPTS; dispatchAttempt += 1) {
    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          jobId,
          provider,
          status,
          attempt,
          error: serializeError(error)
        })
      });

      if (!response.ok) {
        metrics.recordWebhookFailure(provider, String(response.status));
        webhookLogger.error(
          {
            jobId,
            provider,
            status,
            attempt,
            httpStatus: response.status,
            dispatchAttempt
          },
          'webhook responded with non-success status'
        );
      } else {
        webhookLogger.info(
          { jobId, provider, status, attempt, dispatchAttempt },
          'webhook dispatched successfully'
        );
        return;
      }
    } catch (dispatchError) {
      metrics.recordWebhookFailure(provider, 'network');
      webhookLogger.error(
        { jobId, provider, status, attempt, err: dispatchError, dispatchAttempt },
        'webhook dispatch failed'
      );
    }

    if (dispatchAttempt < MAX_DISPATCH_ATTEMPTS) {
      const delayMs = computeBackoffDelay(dispatchAttempt - 1);
      webhookLogger.warn(
        { jobId, provider, status, attempt, dispatchAttempt, delayMs },
        'retrying webhook dispatch'
      );
      await sleep(delayMs);
    }
  }
};
