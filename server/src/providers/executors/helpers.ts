import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

import { fetch } from 'undici';

import { ImageEditRequest, ImageEditResult } from '@providers/types';

export const buildStubResult = (
  provider: string,
  request: ImageEditRequest,
  overrides: Partial<ImageEditResult> = {}
): ImageEditResult => ({
  status: 'succeeded',
  artifacts:
    overrides.artifacts ??
    [
      {
        url: `stub://output/${provider}/${Date.now()}.png`,
        mime: 'image/png'
      }
    ],
  providerMeta: {
    note: 'Stubbed provider executor',
    ...overrides.providerMeta,
    request
  }
});

export const requireEnv = (key: string): string => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable ${key} for provider executor.`);
  }

  return value;
};

const dataUrlRegex = /^data:(?<mime>[^;]+);base64,(?<data>.+)$/;

const looksLikeUrl = (value: string): boolean => /^https?:\/\//i.test(value);

export type LoadedImage = {
  buffer: Buffer;
  contentType: string;
};

export const loadImageBuffer = async (ref: string): Promise<LoadedImage> => {
  if (!ref) {
    throw new Error('Missing image reference');
  }

  const dataUrlMatch = ref.match(dataUrlRegex);
  if (dataUrlMatch?.groups) {
    const { mime, data } = dataUrlMatch.groups;
    return {
      buffer: Buffer.from(data, 'base64'),
      contentType: mime ?? 'image/png'
    };
  }

  if (looksLikeUrl(ref)) {
    const response = await fetch(ref);
    if (!response.ok) {
      throw new Error(`Failed to fetch image from ${ref} – status ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const contentType = response.headers.get('content-type') ?? 'image/png';
    return {
      buffer: Buffer.from(arrayBuffer),
      contentType
    };
  }

  // Assume it is raw base64 without prefix.
  const sanitized = ref.replace(/\s/g, '');
  return {
    buffer: Buffer.from(sanitized, 'base64'),
    contentType: 'image/png'
  };
};

export const toDataUrl = (mimeType: string, base64: string): string => {
  const data = base64.replace(/\s/g, '');
  return `data:${mimeType};base64,${data}`;
};

export const computeSha256 = (buffer: Buffer): string =>
  createHash('sha256').update(buffer).digest('hex');
