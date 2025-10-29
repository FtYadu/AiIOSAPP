import request from 'supertest';

import { createApp } from '../src/app';

describe('POST /v1/assets/uploads', () => {
  const app = createApp();

  it('requires authentication', async () => {
    await request(app).post('/v1/assets/uploads').expect(401);
  });

  it('returns signed upload info', async () => {
    const response = await request(app)
      .post('/v1/assets/uploads')
      .set('Authorization', 'Bearer token:asset-user')
      .send({ kind: 'init', content_type: 'image/png' })
      .expect(200);

    expect(response.body.kind).toBe('init');
    expect(response.body.upload_url).toMatch(/^http/);
    expect(response.body.storage_path).toMatch(/reimagine-uploads\/uploads\/init\//);
    expect(response.body.headers['Content-Type']).toBe('image/png');
    expect(response.body.user_id).toBe('asset-user');
  });
});
