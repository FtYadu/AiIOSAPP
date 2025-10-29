import type { Application } from 'express';
import request from 'supertest';

type SupabaseModuleMock = {
  createClient: jest.Mock;
  __mock: {
    from: jest.Mock;
    select: jest.Mock;
    eq: jest.Mock;
  };
};

jest.mock('@supabase/supabase-js', () => {
  const eq = jest.fn();
  const select = jest.fn(() => ({ eq }));
  const from = jest.fn(() => ({ select }));
  const createClient = jest.fn(() => ({ from }));

  return {
    createClient,
    __mock: { from, select, eq }
  };
});

const loadApp = (): Application => {
  let app: Application | undefined;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createApp } = require('../src/app');
    app = createApp();
  });
  if (!app) {
    throw new Error('Failed to create isolated app instance');
  }
  return app;
};

const getSupabaseMock = (): SupabaseModuleMock =>
  jest.requireMock('@supabase/supabase-js') as SupabaseModuleMock;

describe('GET /v1/providers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const supabase = getSupabaseMock();
    supabase.__mock.eq.mockReset();
  });

  it('lists fallback providers with metadata when Supabase is not configured', async () => {
    const app = loadApp();
    const response = await request(app).get('/v1/providers').expect(200);

    expect(Array.isArray(response.body.providers)).toBe(true);
    expect(response.body.providers.length).toBeGreaterThan(0);
    expect(response.body.providers[0]).toHaveProperty('name');
    expect(response.body.providers[0]).toHaveProperty('guidanceRange');
  });

  it('surfaces Supabase-backed providers when available', async () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';

    const supabase = getSupabaseMock();
    supabase.__mock.eq.mockResolvedValue({
      data: [
        {
          provider: 'supabase-provider',
          endpoint_url: 'https://remote.example/v1',
          model_id: 'model-supabase',
          safety_level: 'balanced',
          enabled: true,
          supports_boxes: true,
          supports_upscale: false,
          guidance_min: 0.2,
          guidance_max: 0.8
        }
      ],
      error: null
    });

    const app = loadApp();

    const response = await request(app).get('/v1/providers').expect(200);

    expect(response.body.providers).toEqual([
      {
        name: 'supabase-provider',
        endpoint: 'https://remote.example/v1',
        modelId: 'model-supabase',
        safetyLevel: 'balanced',
        supportsBoxes: true,
        supportsUpscale: false,
        guidanceRange: [0.2, 0.8]
      }
    ]);
  });

  it('omits disabled providers coming from Supabase', async () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';

    const supabase = getSupabaseMock();
    supabase.__mock.eq.mockResolvedValue({
      data: [
        {
          provider: 'disabled-provider',
          endpoint_url: 'https://remote.disabled/v1',
          model_id: 'model-disabled',
          safety_level: 'balanced',
          enabled: false,
          supports_boxes: false,
          supports_upscale: false,
          guidance_min: 0,
          guidance_max: 1
        }
      ],
      error: null
    });

    const app = loadApp();

    const response = await request(app).get('/v1/providers').expect(200);
    expect(response.body.providers).toEqual([]);
  });
});
