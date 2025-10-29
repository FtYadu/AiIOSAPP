import crypto from 'node:crypto';

import { fetch } from 'undici';

import { metrics } from '@lib/metrics';
import { ImageArtifact } from '@providers/types';

import { findJobById, recordWebhookEvent } from './jobRepository';

type DispatchParams = {
  jobId: string;
  status: 'succeeded' | 'failed';
  artifacts: ImageArtifact[];
  error: string | null;
};

const signPayload = (payload: string): string | null => {
  const secret = process.env.WEBHOOK_SIGNING_SECRET ?? null;
  if (!secret) {
    return null;
  }

  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
};

export const dispatchJobWebhook = async ({ jobId, status, artifacts, error }: DispatchParams): Promise<void> => {
  const job = await findJobById(jobId);
  if (!job?.webhook_url) {
    return;
  }

  const payload = {
    job_id: job.id,
    status,
    provider: job.provider,
    prompt: job.prompt,
    metadata: job.metadata ?? {},
    artifacts,
    error: error ?? job.error,
    updated_at: job.updated_at
  };

  const body = JSON.stringify(payload);
  const signature = signPayload(body);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };

  if (signature) {
    headers['x-imagen-signature'] = signature;
  }

  let statusCode: number | null = null;
  let lastError: string | null = null;

  try {
    const response = await fetch(job.webhook_url, {
      method: 'POST',
      headers,
      body
    });

    statusCode = response.status;

    if (!response.ok) {
      lastError = await response.text();
      metrics.record('webhook.dispatch.error', 1, { status: String(response.status) });
    } else {
      metrics.record('webhook.dispatch.success', 1, { status: String(response.status) });
    }
  } catch (dispatchError) {
    lastError = dispatchError instanceof Error ? dispatchError.message : 'Unknown error';
    metrics.record('webhook.dispatch.error', 1, { status: 'network' });
  } finally {
    try {
      await recordWebhookEvent({
        jobId,
        targetUrl: job.webhook_url,
        status: statusCode,
        attempts: 1,
        lastError
      });
    } catch {
      // Swallow persistence errors to avoid impacting worker execution.
    }
  }
};
