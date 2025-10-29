import crypto from 'node:crypto';

import { fetch } from 'undici';

import { dispatchJobWebhook } from '@lib/webhookDispatcher';
import { findJobById, recordWebhookEvent } from '@lib/jobRepository';

jest.mock('undici', () => ({
  fetch: jest.fn()
}));

jest.mock('@lib/jobRepository', () => ({
  findJobById: jest.fn(),
  recordWebhookEvent: jest.fn()
}));

const fetchMock = jest.mocked(fetch);
const findJobByIdMock = jest.mocked(findJobById);
const recordWebhookEventMock = jest.mocked(recordWebhookEvent);

describe('dispatchJobWebhook', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.WEBHOOK_SIGNING_SECRET = 'sign-secret';
  });

  it('signs payloads, posts to the webhook, and records events', async () => {
    findJobByIdMock.mockResolvedValue({
      id: 'job-1',
      user_id: 'user-1',
      status: 'succeeded',
      prompt: 'paint sunset',
      strength: null,
      guidance: null,
      seed: null,
      size: null,
      output_format: null,
      n: null,
      provider: 'reimagine',
      init_image_url: null,
      mask_url: null,
      error: null,
      metadata: { album: 'summer' },
      webhook_url: 'https://webhooks.example.com/job',
      idempotency_key: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    } as any);

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => ''
    } as any);

    await dispatchJobWebhook({
      jobId: 'job-1',
      status: 'succeeded',
      artifacts: [{ url: 'https://cdn.example.com/out.png', mime: 'image/png' }],
      error: null
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://webhooks.example.com/job',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'x-imagen-signature': expect.any(String)
        })
      })
    );

    const [, init] = fetchMock.mock.calls[0];
    const signature = (init?.headers as Record<string, string>)['x-imagen-signature'];
    const body = init?.body as string;
    const expectedSignature = crypto.createHmac('sha256', 'sign-secret').update(body).digest('hex');
    expect(signature).toEqual(expectedSignature);

    expect(recordWebhookEventMock).toHaveBeenCalledWith({
      jobId: 'job-1',
      targetUrl: 'https://webhooks.example.com/job',
      status: 200,
      attempts: 1,
      lastError: null
    });
  });
});
