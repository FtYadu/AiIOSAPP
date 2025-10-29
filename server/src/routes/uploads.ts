import { Router } from 'express';
import { z } from 'zod';

import { authUserId } from '@lib/auth';
import { createSignedUpload, generateObjectKey } from '@storage/objectStorage';

const signSchema = z.object({
  file_name: z.string().min(1),
  content_type: z.string().min(1),
  bucket: z.enum(['uploads', 'outputs']).default('uploads')
});

export const uploadsRouter = Router();

uploadsRouter.post('/sign', async (req, res) => {
  const userId = authUserId(req);
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const parsed = signSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.message });
  }

  const { file_name: fileName, content_type: contentType, bucket } = parsed.data;
  const extension = fileName.split('.').pop() ?? 'png';
  const key = generateObjectKey(undefined, extension);
  const signedUpload = await createSignedUpload(bucket, key, contentType);

  return res.json({
    upload_url: signedUpload.uploadUrl,
    storage_path: signedUpload.storagePath,
    public_url: signedUpload.publicUrl,
    content_type: signedUpload.contentType
  });
});
