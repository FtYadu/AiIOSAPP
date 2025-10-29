import { Router, type Request } from 'express';
import { z } from 'zod';

import { authenticatedUser, requireAuth } from '@lib/auth';
import { metrics } from '@lib/metrics';
import { getProvider } from '@providers/providerRegistry';
import {
  findJobByIdempotency,
  findJobWithOutputs,
  insertAsset,
  normalizeUserId
} from '@lib/jobRepository';
import { generateObjectKey, uploadBuffer } from '@storage/objectStorage';
import { computeSha256 } from '@providers/executors/helpers';
import { runtimeConfig } from '@config/env';
import sharp from 'sharp';
import { validate as uuidValidate } from 'uuid';

const SIZE_MAP = {
  '1024x1024': { w: 1024, h: 1024 },
  '1024x1792': { w: 1024, h: 1792 },
  '1792x1024': { w: 1792, h: 1024 }
} as const;

const CreateEditSchema = z.object({
  prompt: z.string().min(3),
  init_image_url: z.string().url().optional(),
  init_image_b64: z.string().optional(),
  mask_url: z.string().url().optional(),
  mask_b64: z.string().optional(),
  strength: z.number().min(0).max(1).default(0.7).optional(),
  guidance: z.number().min(0).max(20).default(7.5).optional(),
  seed: z.number().int().optional(),
  size: z.enum(['1024x1024', '1024x1792', '1792x1024']).default('1024x1024').optional(),
  output_format: z.enum(['png', 'jpeg', 'webp']).default('png').optional(),
  n: z.number().int().min(1).max(4).default(1).optional(),
  provider_hint: z.enum(['openai', 'gemini', 'seedream']).optional(),
  webhook_url: z.string().url().optional(),
  idempotency_key: z.string().max(64).optional(),
  metadata: z.record(z.any()).optional()
});

const toDataUrl = (base64: string, format: 'png' | 'jpeg' | 'webp' = 'png'): string => {
  const sanitized = base64.replace(/\s/g, '');
  const mime = format === 'jpeg' ? 'image/jpeg' : `image/${format}`;
  return `data:${mime};base64,${sanitized}`;
};

const parseSizeString = (value?: string) => {
  if (!value) {
    return SIZE_MAP['1024x1024'];
  }
  return SIZE_MAP[value as keyof typeof SIZE_MAP] ?? SIZE_MAP['1024x1024'];
};

const resolveApiBase = (req: Request): string =>
  process.env.API_BASE ?? `${req.protocol}://${req.get('host')}`;

type PendingAsset = {
  kind: 'init' | 'mask';
  storagePath: string;
  publicUrl: string;
  mime: string | null;
  width: number | null;
  height: number | null;
  sha256: string | null;
};

const uploadBase64Asset = async (
  base64: string,
  format: 'png' | 'jpeg' | 'webp',
  kind: 'init' | 'mask'
): Promise<{ url: string; asset: PendingAsset }> => {
  const sanitized = base64.replace(/\s/g, '');
  const buffer = Buffer.from(sanitized, 'base64');
  const mime = format === 'jpeg' ? 'image/jpeg' : `image/${format}`;
  const metadata = await sharp(buffer).metadata();
  const objectKey = generateObjectKey(undefined, format);
  const publicUrl = await uploadBuffer('uploads', objectKey, buffer, mime);

  return {
    url: publicUrl,
    asset: {
      kind,
      storagePath: `${runtimeConfig.uploadsBucket}/${objectKey}`,
      publicUrl,
      mime,
      width: metadata.width ?? null,
      height: metadata.height ?? null,
      sha256: computeSha256(buffer)
    }
  };
};

export const imageEditsRouter = Router();

imageEditsRouter.use(requireAuth);

imageEditsRouter.post('/', async (req, res, next) => {
  try {
    const userId = authenticatedUser(req)?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const body = CreateEditSchema.parse(req.body ?? {});
    const idempotencyKey = body.idempotency_key ?? req.header('Idempotency-Key') ?? undefined;

    if (idempotencyKey) {
      const existing = await findJobByIdempotency(userId, idempotencyKey);
      if (existing) {
        return res.status(409).json({
          job_id: existing.id,
          status: existing.status,
          poll_url: `${resolveApiBase(req)}/v1/images/edits/${existing.id}`
        });
      }
    }

    const providerName = body.provider_hint ?? 'openai';
    const provider = await getProvider(providerName);
    if (!provider) {
      return res.status(404).json({ error: `Provider ${providerName} not available` });
    }

    const pendingAssets: PendingAsset[] = [];

    let baseImage: string | undefined = body.init_image_url ?? undefined;
    if (!baseImage && body.init_image_b64) {
      const { url, asset } = await uploadBase64Asset(
        body.init_image_b64,
        body.output_format ?? 'png',
        'init'
      );
      baseImage = url;
      pendingAssets.push(asset);
    }

    let maskImage: string | undefined = body.mask_url ?? undefined;
    if (!maskImage && body.mask_b64) {
      const { url, asset } = await uploadBase64Asset(body.mask_b64, 'png', 'mask');
      maskImage = url;
      pendingAssets.push(asset);
    }

    const size = parseSizeString(body.size);

    const job = await provider.enqueueEdit(
      {
        baseImage,
        prompt: body.prompt,
        guidance: body.guidance,
        strength: body.strength,
        seed: body.seed,
        size,
        maskImage,
        format: body.output_format ?? 'png'
      },
      {
        userId,
        prompt: body.prompt,
        idempotencyKey,
        metadata: body.metadata,
        webhookUrl: body.webhook_url
      }
    );

    for (const asset of pendingAssets) {
      await insertAsset({
        jobId: job.jobId,
        kind: asset.kind,
        storagePath: asset.storagePath,
        publicUrl: asset.publicUrl,
        mime: asset.mime,
        width: asset.width,
        height: asset.height,
        sha256: asset.sha256
      });
    }

    metrics.record('routes.image_edits.accepted', 1, { provider: providerName });

    return res.status(202).json({
      job_id: job.jobId,
      status: job.status,
      poll_url: `${resolveApiBase(req)}/v1/images/edits/${job.jobId}`
    });
  } catch (error) {
    metrics.record('routes.image_edits.error', 1);
    return next(error);
  }
});

imageEditsRouter.get('/:jobId', async (req, res) => {
  const userId = authenticatedUser(req)?.userId;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!uuidValidate(req.params.jobId)) {
    return res.status(404).json({ error: 'Job not found' });
  }
  const record = await findJobWithOutputs(req.params.jobId);
  if (!record) {
    return res.status(404).json({ error: 'Job not found' });
  }

  if (normalizeUserId(userId) !== record.job.user_id) {
    return res.status(404).json({ error: 'Job not found' });
  }

  const outputs = record.outputs.map((asset) => ({
    url: asset.public_url ?? asset.storage_path,
    mime: asset.mime ?? 'image/png',
    sha256: asset.sha256 ?? null,
    width: asset.width ?? null,
    height: asset.height ?? null
  }));

  const urls = record.outputs.map((asset) => asset.public_url ?? asset.storage_path);

  return res.json({
    job_id: record.job.id,
    status: record.job.status,
    created_at: record.job.created_at,
    updated_at: record.job.updated_at,
    error: record.job.error,
    outputs,
    previews: urls,
    outputs_urls: urls
  });
});
