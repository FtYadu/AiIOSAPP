import crypto from 'node:crypto';

import { PutObjectCommand, getSignedUrl, s3Client } from '@storage/s3Client';
import { runtimeConfig } from '@config/env';

const { uploadsBucket, outputsBucket, s3Endpoint } = runtimeConfig;

const publicUrlFor = (bucket: string, key: string): string => {
  const endpoint = s3Endpoint?.replace(/\/+$/, '') ?? '';
  return `${endpoint}/${bucket}/${key}`;
};

export type SignedUpload = {
  uploadUrl: string;
  storagePath: string;
  publicUrl: string;
  contentType: string;
};

export const createSignedUpload = async (
  bucket: 'uploads' | 'outputs',
  key: string,
  contentType: string
): Promise<SignedUpload> => {
  const resolvedBucket = bucket === 'uploads' ? uploadsBucket : outputsBucket;
  const command = new PutObjectCommand({
    Bucket: resolvedBucket,
    Key: key,
    ContentType: contentType
  });

  const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 60 });

  return {
    uploadUrl,
    storagePath: `${resolvedBucket}/${key}`,
    publicUrl: publicUrlFor(resolvedBucket, key),
    contentType
  };
};

export const uploadBuffer = async (
  bucket: 'uploads' | 'outputs',
  key: string,
  buffer: Buffer,
  contentType: string
): Promise<string> => {
  const resolvedBucket = bucket === 'uploads' ? uploadsBucket : outputsBucket;
  await s3Client.send(
    new PutObjectCommand({
      Bucket: resolvedBucket,
      Key: key,
      Body: buffer,
      ContentType: contentType
    })
  );

  return publicUrlFor(resolvedBucket, key);
};

export const generateObjectKey = (jobId: string | undefined, format: string) => {
  const id = crypto.randomUUID();
  const ext = format.startsWith('.') ? format.slice(1) : format;
  const prefix = jobId ? `${jobId}` : 'uploads';
  return `${prefix}/${id}.${ext}`;
};
