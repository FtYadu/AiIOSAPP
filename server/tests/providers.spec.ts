import request from 'supertest';

import { createApp } from '../src/app';

describe('GET /v1/providers', () => {
  const app = createApp();

  it('lists enabled providers with metadata', async () => {
    const response = await request(app).get('/v1/providers').expect(200);
    expect(Array.isArray(response.body.providers)).toBe(true);
    expect(response.body.providers.length).toBeGreaterThan(0);
    expect(response.body.providers[0]).toHaveProperty('name');
    expect(response.body.providers[0]).toHaveProperty('guidanceRange');
  });
});
