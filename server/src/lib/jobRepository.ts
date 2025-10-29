import { randomUUID } from 'node:crypto';

import { db } from '@lib/db';
import { validate as uuidValidate, v5 as uuidv5 } from 'uuid';

const USER_NAMESPACE = '7a53c12b-8986-4a32-9c8d-1eae2e6d5e6f';

export const normalizeUserId = (userId: string): string => {
  if (uuidValidate(userId)) {
    return userId;
  }
  return uuidv5(userId, USER_NAMESPACE);
};

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export type JobRow = {
  id: string;
  user_id: string;
  status: JobStatus;
  prompt: string;
  strength: number | null;
  guidance: number | null;
  seed: number | null;
  size: string | null;
  output_format: string | null;
  n: number | null;
  provider: string | null;
  init_image_url: string | null;
  mask_url: string | null;
  error: string | null;
  metadata: Record<string, unknown>;
  webhook_url: string | null;
  idempotency_key: string | null;
  created_at: string;
  updated_at: string;
};

export type AssetRow = {
  id: string;
  job_id: string;
  kind: 'init' | 'mask' | 'output';
  storage_path: string;
  public_url: string | null;
  mime: string | null;
  width: number | null;
  height: number | null;
  sha256: string | null;
  created_at: string;
};

export const createJob = async (params: {
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
  await db.query(`insert into providers (key) values ($1) on conflict (key) do nothing`, [
    params.provider
  ]);

  const jobId = randomUUID();
  const result = await db.query<JobRow>(
    `insert into image_jobs (id, user_id, provider, prompt, strength, guidance, seed, size, output_format, n, init_image_url, mask_url, metadata, webhook_url, idempotency_key, status)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'queued')
     returning *`,
    [
      jobId,
      normalizeUserId(params.userId),
      params.provider,
      params.prompt,
      params.strength ?? null,
      params.guidance ?? null,
      params.seed ?? null,
      params.size ?? null,
      params.outputFormat ?? null,
      params.n ?? null,
      params.initImageUrl ?? null,
      params.maskUrl ?? null,
      params.metadata ?? {},
      params.webhookUrl ?? null,
      params.idempotencyKey ?? null
    ]
  );

  return result.rows[0];
};

export const findJobByIdempotency = async (
  userId: string,
  key: string
): Promise<JobRow | null> => {
  const result = await db.query<JobRow>(
    `select * from image_jobs where user_id = $1 and idempotency_key = $2`,
    [normalizeUserId(userId), key]
  );
  return result.rows[0] ?? null;
};

export const findJobWithOutputs = async (
  jobId: string
): Promise<{ job: JobRow; outputs: AssetRow[] } | null> => {
  const jobResult = await db.query<JobRow>(`select * from image_jobs where id=$1`, [jobId]);
  if (jobResult.rowCount === 0) {
    return null;
  }

  const assets = await db.query<AssetRow>(
    `select * from image_assets where job_id=$1 and kind='output' order by created_at asc`,
    [jobId]
  );

  return {
    job: jobResult.rows[0],
    outputs: assets.rows
  };
};

export const insertAsset = async (params: {
  jobId: string;
  kind: 'init' | 'mask' | 'output';
  storagePath: string;
  publicUrl: string | null;
  mime: string | null;
  width?: number | null;
  height?: number | null;
  sha256?: string | null;
}): Promise<void> => {
  const id = randomUUID();
  await db.query(
    `insert into image_assets (id, job_id, kind, storage_path, public_url, mime, width, height, sha256)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      id,
      params.jobId,
      params.kind,
      params.storagePath,
      params.publicUrl,
      params.mime,
      params.width ?? null,
      params.height ?? null,
      params.sha256 ?? null
    ]
  );
};

export const updateJobStatus = async (jobId: string, status: JobStatus, error?: string | null) => {
  await db.query(`update image_jobs set status=$2, error=$3 where id=$1`, [
    jobId,
    status,
    error ?? null
  ]);
};

export const appendArtifacts = async (
  jobId: string,
  artifacts: Array<{
    url: string;
    storagePath?: string;
    mime: string;
    sha256?: string;
    width?: number | null;
    height?: number | null;
  }>
) => {
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
};
