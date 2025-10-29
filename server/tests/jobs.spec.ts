import request from 'supertest';

import { createApp } from '../src/app';

describe('GET /v1/jobs/:jobId', () => {
  const app = createApp();

  it('returns job status once queued', async () => {
    const queued = await request(app)
      .post('/v1/images/edits')
      .set('Authorization', 'Bearer token:user-jobs')
      .send({
        prompt: 'change sky to sunset',
        init_image_b64:
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII='
      })
      .expect(202);

    const jobId = queued.body.job_id;
    const jobResponse = await request(app).get(`/v1/jobs/${jobId}`).expect(200);

    expect(jobResponse.body.jobId).toEqual(jobId);
    expect(jobResponse.body.provider).toEqual('openai');
    expect(Array.isArray(jobResponse.body.previews)).toBe(true);
    expect(Array.isArray(jobResponse.body.outputs)).toBe(true);
  });

  it('404s for missing job', async () => {
    await request(app)
      .get('/v1/jobs/00000000-0000-0000-0000-000000000001')
      .expect(404);
  });
});
