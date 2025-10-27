export type Box = {
  x: number;
  y: number;
  w: number;
  h: number;
  label?: string;
};

export type ImageEditRequest = {
  baseImage?: string;
  prompt: string;
  boxes?: Box[];
  guidance?: number;
  strength?: number;
  seed?: number;
  size?: {
    w: number;
    h: number;
  };
  maskImage?: string;
  format?: 'png' | 'jpeg' | 'webp';
};

export type ImageArtifact = {
  url: string;
  mime: string;
  storagePath?: string;
  sha256?: string;
  width?: number;
  height?: number;
};

export type ImageEditResult = {
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  artifacts: ImageArtifact[];
  providerMeta: Record<string, unknown>;
};

export type ProviderJob = {
  jobId: string;
  provider: string;
  status: ImageEditResult['status'];
  createdAt: string;
  updatedAt: string;
};

export type EnqueueOptions = {
  userId?: string;
  prompt?: string;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
  webhookUrl?: string;
};

export interface ProviderAdapter {
  readonly name: string;
  enqueueEdit(request: ImageEditRequest, options?: EnqueueOptions): Promise<ProviderJob>;
  fetchResult(jobId: string): Promise<ImageEditResult>;
}
