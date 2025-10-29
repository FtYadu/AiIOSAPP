import 'dotenv/config';

process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://neondb_owner:npg_2X9QlnPMpgVE@ep-falling-mode-ad2jsr6x-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

process.env.S3_ENDPOINT = process.env.S3_ENDPOINT ?? 'http://127.0.0.1:9000';
process.env.S3_REGION = process.env.S3_REGION ?? 'us-east-1';
process.env.S3_ACCESS_KEY = process.env.S3_ACCESS_KEY ?? 'minioadmin';
process.env.S3_SECRET_KEY = process.env.S3_SECRET_KEY ?? 'minioadmin123';
process.env.REIMAGINE_UPLOADS_BUCKET = process.env.REIMAGINE_UPLOADS_BUCKET ?? 'reimagine-uploads';
process.env.REIMAGINE_OUTPUTS_BUCKET = process.env.REIMAGINE_OUTPUTS_BUCKET ?? 'reimagine-outputs';
process.env.SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'supabase-service-role-key';
delete process.env.RABBITMQ_URL;

jest.mock('@supabase/supabase-js', () => {
  const createClient = () => ({
    auth: {
      getUser: async (token: string) => {
        if (token.startsWith('token:')) {
          const userId = token.slice('token:'.length);
          return { data: { user: { id: userId } }, error: null };
        }
        return { data: { user: null }, error: new Error('invalid token') };
      }
    }
  });

  return { createClient };
});

jest.mock('@storage/objectStorage', () => {
  const actual = jest.requireActual('@storage/objectStorage');
  return {
    ...actual,
    uploadBuffer: jest
      .fn()
      .mockImplementation(async (_bucket: 'uploads' | 'outputs', key: string) => `https://mock.storage/${key}`),
    createSignedUpload: jest.fn().mockImplementation(
      async (_bucket: 'uploads' | 'outputs', key: string, contentType: string) => ({
        uploadUrl: `https://mock.upload/${key}`,
        storagePath: `${process.env.REIMAGINE_UPLOADS_BUCKET ?? 'reimagine-uploads'}/${key}`,
        publicUrl: `https://mock.storage/${key}`,
        contentType
      })
    )
  };
});

jest.mock('@lib/jobRepository', () => {
  const { randomUUID } = require('node:crypto');
  type JobRow = import('@lib/jobRepository').JobRow;
  type AssetRow = import('@lib/jobRepository').AssetRow;

  const jobs = new Map<string, JobRow>();
  const assets = new Map<string, AssetRow[]>();

  const normalizeUserId = (userId: string) => userId;

  const insertAsset = jest.fn(async (params: {
    jobId: string;
    kind: 'init' | 'mask' | 'output';
    storagePath: string;
    publicUrl: string | null;
    mime: string | null;
    width?: number | null;
    height?: number | null;
    sha256?: string | null;
  }) => {
    const record: AssetRow = {
      id: randomUUID(),
      job_id: params.jobId,
      kind: params.kind,
      storage_path: params.storagePath,
      public_url: params.publicUrl,
      mime: params.mime,
      width: params.width ?? null,
      height: params.height ?? null,
      sha256: params.sha256 ?? null,
      created_at: new Date().toISOString()
    };
    const existing = assets.get(params.jobId) ?? [];
    existing.push(record);
    assets.set(params.jobId, existing);
  });

  return {
    normalizeUserId,
    insertAsset,
    createJob: jest.fn(async (params: {
      userId: string;
      provider: string;
      prompt: string;
      strength?: number;
      guidance?: number;
      seed?: number;
      size?: string;
      outputFormat?: string;
      n?: number;
      initImageUrl?: string | null;
      maskUrl?: string | null;
      metadata?: Record<string, unknown>;
      webhookUrl?: string | null;
      idempotencyKey?: string | null;
    }): Promise<JobRow> => {
      const id = randomUUID();
      const now = new Date().toISOString();
      const job: JobRow = {
        id,
        user_id: normalizeUserId(params.userId),
        status: 'queued',
        prompt: params.prompt,
        strength: params.strength ?? null,
        guidance: params.guidance ?? null,
        seed: params.seed ?? null,
        size: params.size ?? null,
        output_format: params.outputFormat ?? null,
        n: params.n ?? 1,
        provider: params.provider,
        init_image_url: params.initImageUrl ?? null,
        mask_url: params.maskUrl ?? null,
        error: null,
        metadata: params.metadata ?? {},
        webhook_url: params.webhookUrl ?? null,
        idempotency_key: params.idempotencyKey ?? null,
        created_at: now,
        updated_at: now
      };
      jobs.set(id, job);
      return job;
    }),
    findJobByIdempotency: jest.fn(async (userId: string, key: string): Promise<JobRow | null> => {
      const normalized = normalizeUserId(userId);
      for (const job of jobs.values()) {
        if (job.user_id === normalized && job.idempotency_key === key) {
          return job;
        }
      }
      return null;
    }),
    findJobWithOutputs: jest.fn(async (jobId: string) => {
      const job = jobs.get(jobId);
      if (!job) {
        return null;
      }
      return {
        job,
        outputs: assets.get(jobId)?.filter((asset) => asset.kind === 'output') ?? []
      };
    }),
    appendArtifacts: jest.fn(async (jobId: string, artifacts: Array<{
      url: string;
      storagePath?: string;
      mime: string;
      sha256?: string;
      width?: number | null;
      height?: number | null;
    }>) => {
      for (const artifact of artifacts) {
        await insertAsset({
          jobId,
          kind: 'output',
          storagePath: artifact.storagePath ?? artifact.url,
          publicUrl: artifact.url,
          mime: artifact.mime,
          width: artifact.width ?? null,
          height: artifact.height ?? null,
          sha256: artifact.sha256 ?? null
        });
      }
    }),
    updateJobStatus: jest.fn(async (jobId: string, status: string, error?: string | null) => {
      const job = jobs.get(jobId);
      if (job) {
        job.status = status as JobRow['status'];
        job.error = error ?? null;
        job.updated_at = new Date().toISOString();
      }
    })
  };
});
