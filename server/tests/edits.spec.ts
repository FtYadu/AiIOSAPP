import request from 'supertest';

import { createApp } from '../src/app';

describe('POST /v1/edits', () => {
  const app = createApp();

  it('queues an edit job', async () => {
    const response = await request(app)
      .post('/v1/edits')
      .set('x-user-id', '33333333-3333-3333-3333-333333333333')
      .send({
        provider: 'openai',
        imageRef: 'stub://image.png',
        prompt: 'make it sunset'
      })
      .expect(202);

    expect(response.body.jobId).toBeDefined();
  });

  it('rejects invalid payload', async () => {
    const response = await request(app)
      .post('/v1/edits')
      .set('x-user-id', '33333333-3333-3333-3333-333333333333')
      .send({})
      .expect(400);
    expect(response.body.error).toBeDefined();
  });
});
