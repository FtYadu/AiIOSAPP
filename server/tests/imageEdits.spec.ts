import { randomUUID } from 'node:crypto';
import request from 'supertest';

import { createApp } from '../src/app';

const BASE64_PIXEL =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=';

describe('Reimagine Image Edit API', () => {
  const app = createApp();

  beforeAll(() => {
    process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? 'test-openai-key';
    process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? 'test-gemini-key';
    process.env.SEEDREAM_API_KEY = process.env.SEEDREAM_API_KEY ?? 'test-seedream-key';
  });

  it('creates an edit job with base64 upload fallback', async () => {
    const response = await request(app)
      .post('/v1/images/edits')
      .set('x-user-id', '11111111-1111-1111-1111-111111111111')
      .send({
        prompt: 'Make it futuristic neon cityscape',
        init_image_b64: BASE64_PIXEL,
        provider_hint: 'openai'
      })
      .expect(202);

    expect(response.body.job_id).toBeDefined();
    expect(response.body.poll_url).toContain(response.body.job_id);

    const job = await request(app)
      .get(`/v1/images/edits/${response.body.job_id}`)
      .set('x-user-id', 'user-123')
      .expect(200);

    expect(job.body.status).toBeDefined();
    expect(Array.isArray(job.body.outputs)).toBe(true);
  });

  it('returns 409 on idempotent replays', async () => {
    const idempotencyKey = `key-${randomUUID()}`;

    const first = await request(app)
      .post('/v1/images/edits')
      .set('x-user-id', '22222222-2222-2222-2222-222222222222')
      .send({
        prompt: 'Turn into grayscale',
        init_image_b64: BASE64_PIXEL,
        idempotency_key: idempotencyKey
      })
      .expect(202);

    await request(app)
      .post('/v1/images/edits')
      .set('x-user-id', '22222222-2222-2222-2222-222222222222')
      .send({
        prompt: 'Turn into grayscale',
        init_image_b64: BASE64_PIXEL,
        idempotency_key: idempotencyKey
      })
      .expect(409)
      .expect((res) => {
        expect(res.body.job_id).toEqual(first.body.job_id);
      });
  });
});
