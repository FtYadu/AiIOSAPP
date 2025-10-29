import { Buffer } from 'node:buffer';
import { setTimeout as delay } from 'node:timers/promises';

import { fetch } from 'undici';

import { metrics } from '@lib/metrics';
import { ProviderConfig } from '@lib/remoteConfig';
import { ImageEditRequest, ImageEditResult, ImageArtifact } from '@providers/types';

import { loadImageBuffer, requireEnv, computeSha256, toDataUrl } from './helpers';
import { downloadToBuffer } from '@util/http';
import { storeOutputs, OutputBuffer, ImageFormat } from '@util/storeOutputs';

type ReimagineArtifact = {
  url?: string;
  base64?: string;
  mime?: string;
  width?: number | null;
  height?: number | null;
  sha256?: string | null;
};

type ReimagineJobPayload = {
  id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  artifacts?: ReimagineArtifact[];
  error?: string | null;
  metadata?: Record<string, unknown>;
};

const MAX_POLLS = 30;
const POLL_INTERVAL_MS = 1000;

const mimeToFormat = (mime?: string): ImageFormat => {
  if (!mime) {
    return 'png';
  }
  if (mime.includes('jpeg') || mime.includes('jpg')) {
    return 'jpeg';
  }
  if (mime.includes('webp')) {
    return 'webp';
  }
  return 'png';
};

const serializeRequestPayload = async (
  request: ImageEditRequest,
  modelId: string
): Promise<Record<string, unknown>> => {
  const payload: Record<string, unknown> = {
    model: modelId,
    prompt: request.prompt
  };

  if (request.baseImage) {
    const base = await loadImageBuffer(request.baseImage);
    payload.init_image = base.buffer.toString('base64');
    payload.init_mime = base.contentType;
  }

  if (request.maskImage) {
    const mask = await loadImageBuffer(request.maskImage);
    payload.mask_image = mask.buffer.toString('base64');
    payload.mask_mime = mask.contentType;
  }

  if (request.guidance !== undefined) {
    payload.guidance = request.guidance;
  }
  if (request.strength !== undefined) {
    payload.strength = request.strength;
  }
  if (request.seed !== undefined) {
    payload.seed = request.seed;
  }
  if (request.size) {
    payload.size = { width: request.size.w, height: request.size.h };
  }

  return payload;
};

const normalizeArtifacts = async (
  jobId: string,
  artifacts: ReimagineArtifact[] | undefined
): Promise<ImageArtifact[]> => {
  if (!artifacts?.length) {
    return [];
  }

  const buffers: OutputBuffer[] = [];
  const passthrough: ImageArtifact[] = [];

  for (const artifact of artifacts) {
    if (artifact.base64) {
      const mime = artifact.mime ?? 'image/png';
      const buffer = Buffer.from(artifact.base64, 'base64');
      buffers.push({
        buffer,
        format: mimeToFormat(mime),
        mime
      });
    } else if (artifact.url) {
      try {
        const downloaded = await downloadToBuffer(artifact.url);
        buffers.push({
          buffer: downloaded.buffer,
          format: mimeToFormat(downloaded.mimeType),
          mime: downloaded.mimeType
        });
      } catch (error) {
        metrics.record('provider.reimagine.download_error', 1);
        passthrough.push({
          url: artifact.url,
          mime: artifact.mime ?? 'image/png',
          sha256: artifact.sha256 ?? undefined,
          width: artifact.width ?? undefined,
          height: artifact.height ?? undefined
        });
      }
    }
  }

  const stored: ImageArtifact[] = [];

  if (buffers.length) {
    const storedArtifacts = await storeOutputs(jobId, buffers);
    stored.push(
      ...storedArtifacts.map((artifact) => ({
        url: artifact.url,
        mime: artifact.mime,
        storagePath: artifact.storagePath,
        sha256: artifact.sha256,
        width: artifact.width ?? undefined,
        height: artifact.height ?? undefined
      }))
    );
  }

  if (!buffers.length && passthrough.length === 0) {
    // No convertible artifacts – fallback to inline normalization
    for (const artifact of artifacts) {
      if (artifact.base64) {
        const mime = artifact.mime ?? 'image/png';
        const buffer = Buffer.from(artifact.base64, 'base64');
        stored.push({
          url: toDataUrl(mime, artifact.base64),
          mime,
          sha256: computeSha256(buffer),
          width: artifact.width ?? undefined,
          height: artifact.height ?? undefined
        });
      } else if (artifact.url) {
        stored.push({
          url: artifact.url,
          mime: artifact.mime ?? 'image/png',
          sha256: artifact.sha256 ?? undefined,
          width: artifact.width ?? undefined,
          height: artifact.height ?? undefined
        });
      }
    }
  }

  return stored.length ? [...stored, ...passthrough] : passthrough;
};

const pollForCompletion = async (
  endpoint: string,
  jobId: string,
  apiKey: string
): Promise<ReimagineJobPayload> => {
  let attempts = 0;
  while (attempts < MAX_POLLS) {
    const response = await fetch(`${endpoint}/v1/jobs/${jobId}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Reimagine polling failed: ${response.status} ${errorText}`);
    }

    const payload = (await response.json()) as ReimagineJobPayload;

    if (payload.status === 'succeeded' || payload.status === 'failed') {
      return payload;
    }

    attempts += 1;
    await delay(POLL_INTERVAL_MS);
  }

  throw new Error('Reimagine job polling timed out');
};

export const handleReimagineEdit = async (
  jobId: string,
  request: ImageEditRequest,
  config: ProviderConfig
): Promise<ImageEditResult> => {
  metrics.record('provider.reimagine.invoke', 1);

  const apiKey = requireEnv('REIMAGINE_API_KEY');
  const endpoint = config.endpoint ?? 'https://api.eternal.ai';
  const modelId = config.modelId ?? 'reimagine-edit-latest';

  const payload = await serializeRequestPayload(request, modelId);

  try {
    const response = await fetch(`${endpoint}/v1/edits`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      metrics.record('provider.reimagine.error', 1, { phase: 'submit' });
      throw new Error(`Reimagine request failed: ${response.status} ${errorText}`);
    }

    const initial = (await response.json()) as ReimagineJobPayload;

    const finalPayload =
      initial.status === 'succeeded' || initial.status === 'failed'
        ? initial
        : await pollForCompletion(endpoint, initial.id, apiKey);

    if (finalPayload.status === 'failed') {
      metrics.record('provider.reimagine.error', 1, { phase: 'complete' });
      throw new Error(finalPayload.error ?? 'Reimagine job failed');
    }

    const artifacts = await normalizeArtifacts(jobId, finalPayload.artifacts);

    if (!artifacts.length) {
      metrics.record('provider.reimagine.error', 1, { phase: 'artifacts' });
      throw new Error('Reimagine did not return any artifacts');
    }

    return {
      status: 'succeeded',
      artifacts,
      providerMeta: {
        endpoint,
        modelId,
        jobId: finalPayload.id,
        metadata: finalPayload.metadata ?? {}
      }
    };
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Reimagine executor encountered an unknown error');
  }
};
