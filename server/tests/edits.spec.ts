import request from 'supertest';

import { createApp } from '../src/app';

describe('POST /v1/edits', () => {
  const app = createApp();

  it('returns 410 and migration guidance', async () => {
    const response = await request(app).post('/v1/edits').send({}).expect(410);
    expect(response.body.error).toMatch(/Use POST \/v1\/images\/edits/);
  });
});
