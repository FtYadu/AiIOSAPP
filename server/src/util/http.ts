import { fetch } from 'undici';

export type DownloadedBuffer = {
  buffer: Buffer;
  mimeType: string;
};

export const downloadToBuffer = async (url: string): Promise<DownloadedBuffer> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  const mimeType = response.headers.get('content-type') ?? 'application/octet-stream';
  return {
    buffer: Buffer.from(arrayBuffer),
    mimeType
  };
};
