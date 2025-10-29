import { Router } from 'express';
import { z } from 'zod';

import { authenticatedUser, requireAuth } from '@lib/auth';
import { createSignedUpload, generateObjectKey } from '@storage/objectStorage';

export const assetsRouter = Router();

assetsRouter.get('/:assetId', (req, res) => {
  const { assetId } = req.params;
  // In production this would sign and redirect; for now provide a stub URL.
  return res.json({
    assetId,
    url: `https://cdn.example.com/assets/${assetId}?token=stub`
  });
});

const SignedUploadSchema = z.object({
  kind: z.enum(['init', 'mask']).default('init'),
  content_type: z.string().min(3).default('image/png')
});

assetsRouter.post('/uploads', requireAuth, async (req, res, next) => {
  try {
    const userId = authenticatedUser(req)?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const payload = SignedUploadSchema.parse(req.body ?? {});
    const format = payload.content_type.split('/')[1] ?? 'png';
    const rawKey = generateObjectKey(undefined, format);
    const objectKey = rawKey.replace(/^uploads\//, `uploads/${payload.kind}/`);

    const signed = await createSignedUpload('uploads', objectKey, payload.content_type);

    return res.json({
      kind: payload.kind,
      upload_url: signed.uploadUrl,
      storage_path: signed.storagePath,
      public_url: signed.publicUrl,
      headers: {
        'Content-Type': signed.contentType
      },
      user_id: userId
    });
  } catch (error) {
    return next(error);
  }
});
