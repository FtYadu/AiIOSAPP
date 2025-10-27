import request from 'supertest';

import { createApp } from '../src/app';

describe('GET /v1/trends', () => {
  const app = createApp();

  it('returns provider-derived trends', async () => {
    const response = await request(app).get('/v1/trends').expect(200);
    expect(Array.isArray(response.body.trends)).toBe(true);
    expect(response.body.trends[0]).toHaveProperty('term');
    expect(response.body.trends[0]).toHaveProperty('provider');
  });
});
