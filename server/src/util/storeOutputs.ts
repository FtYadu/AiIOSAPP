import crypto from 'node:crypto';

import sharp from 'sharp';

import { runtimeConfig } from '@config/env';
import { generateObjectKey, uploadBuffer } from '@storage/objectStorage';

export type StoredArtifact = {
  url: string;
  storagePath: string;
  mime: string;
  sha256: string;
  width?: number | null;
  height?: number | null;
};

export type ImageFormat = 'png' | 'jpeg' | 'webp';

export const formatToMime = (format: ImageFormat): string => {
  switch (format) {
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    default:
      return 'image/png';
  }
};

export type OutputBuffer = {
  buffer: Buffer;
  format: ImageFormat;
  mime: string;
};

export const storeOutputs = async (jobId: string, outputs: OutputBuffer[]): Promise<StoredArtifact[]> => {
  const results: StoredArtifact[] = [];

  for (const output of outputs) {
    const hash = crypto.createHash('sha256').update(output.buffer).digest('hex');
    const objectKey = generateObjectKey(jobId, output.format);
    const publicUrl = await uploadBuffer('outputs', objectKey, output.buffer, output.mime);

    const image = sharp(output.buffer);
    const metadata = await image.metadata();

    results.push({
      url: publicUrl,
      storagePath: `${runtimeConfig.outputsBucket}/${objectKey}`,
      mime: output.mime,
      sha256: hash,
      width: metadata.width ?? null,
      height: metadata.height ?? null
    });
  }

  return results;
};
