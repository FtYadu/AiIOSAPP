import request from 'supertest';

import { createApp } from '../src/app';

describe('GET /v1/jobs/:jobId', () => {
  const app = createApp();

  it('returns job status once queued', async () => {
    const queued = await request(app)
      .post('/v1/edits')
      .set('x-user-id', '44444444-4444-4444-4444-444444444444')
      .send({
        provider: 'reimagine',
        imageRef: 'stub://image.png',
        prompt: 'change sky to sunset'
      })
      .expect(202);

    const { jobId } = queued.body;
    const jobResponse = await request(app).get(`/v1/jobs/${jobId}`).expect(200);

    expect(jobResponse.body.jobId).toEqual(jobId);
    expect(jobResponse.body.provider).toEqual('reimagine');
  });

  it('404s for missing job', async () => {
    await request(app)
      .get('/v1/jobs/00000000-0000-0000-0000-000000000001')
      .expect(404);
  });
});
