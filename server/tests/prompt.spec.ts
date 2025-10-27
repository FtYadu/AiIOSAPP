import request from 'supertest';

import { createApp } from '../src/app';

describe('POST /v1/prompt/suggest', () => {
  const app = createApp();

  it('returns prompt suggestions', async () => {
    const response = await request(app)
      .post('/v1/prompt/suggest')
      .send({
        intent: 'add neon rain',
        context: { provider: 'openai' }
      })
      .expect(200);

    expect(response.body.suggestions).toHaveLength(3);
    expect(response.body.provider).toEqual('openai');
    expect(response.body.safetyLevel).toBeDefined();
    expect(response.body.tokens.guidance).toBeGreaterThanOrEqual(0);
  });
});
