import { Buffer } from 'node:buffer';

import { fetch } from 'undici';

import { metrics } from '@lib/metrics';
import { ProviderConfig } from '@lib/remoteConfig';
import { ImageEditRequest, ImageEditResult } from '@providers/types';

import { loadImageBuffer, requireEnv, computeSha256, toDataUrl } from './helpers';
import { downloadToBuffer } from '@util/http';
import { storeOutputs, OutputBuffer } from '@util/storeOutputs';

type SeedreamResponsesPayload = {
  id?: string;
  result?: {
    output?: Array<
      | { type: 'text'; text: string }
      | { type: 'image'; image_base64?: string; mime_type?: string; url?: string }
    >;
  };
};

export const handleSeedreamEdit = async (
  jobId: string,
  request: ImageEditRequest,
  config: ProviderConfig
): Promise<ImageEditResult> => {
  metrics.record('provider.seedream.invoke', 1, { hasImage: String(Boolean(request.baseImage)) });

  const apiKey = requireEnv('SEEDREAM_API_KEY');
  const endpoint = config.endpoint ?? process.env.SEEDREAM_ENDPOINT;
  if (!endpoint) {
    throw new Error('Missing SEEDREAM_ENDPOINT; refer to BytePlus Regions and Access Domains.');
  }

  const modelId = config.modelId ?? process.env.SEEDREAM_MODEL_ID ?? 'seedream-4.0';

  const userContent: Array<{ type: string; [key: string]: unknown }> = [{
    type: 'text',
    text: request.prompt
  }];

  if (request.baseImage) {
    const image = await loadImageBuffer(request.baseImage);
    userContent.push({
      type: 'image',
      mime_type: image.contentType,
      image_base64: image.buffer.toString('base64')
    });
  }

  const body = {
    model: modelId,
    input: {
      messages: [
        {
          role: 'user',
          content: userContent
        }
      ]
    }
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorText = await response.text();
    metrics.record('provider.seedream.error', 1, { status: String(response.status) });
    throw new Error(`Seedream request failed: ${response.status} ${errorText}`);
  }

  const payload = (await response.json()) as SeedreamResponsesPayload;
  const inlineArtifacts: Array<{ url: string; mime: string; sha256?: string }> = [];
  const buffers: OutputBuffer[] = [];

  for (const item of payload.result?.output ?? []) {
    if (item.type === 'image') {
      if ('image_base64' in item && item.image_base64) {
        const mime = item.mime_type ?? 'image/png';
        const buffer = Buffer.from(item.image_base64, 'base64');
        buffers.push({
          buffer,
          mime,
          format: mime.includes('jpeg') ? 'jpeg' : mime.includes('webp') ? 'webp' : 'png'
        });
        inlineArtifacts.push({
          url: toDataUrl(mime, item.image_base64),
          mime,
          sha256: computeSha256(buffer)
        });
      } else if ('url' in item && item.url) {
        const downloaded = await downloadToBuffer(item.url);
        buffers.push({
          buffer: downloaded.buffer,
          mime: downloaded.mimeType,
          format: downloaded.mimeType.includes('jpeg')
            ? 'jpeg'
            : downloaded.mimeType.includes('webp')
              ? 'webp'
              : 'png'
        });
        inlineArtifacts.push({
          url: item.url,
          mime: downloaded.mimeType,
          sha256: computeSha256(downloaded.buffer)
        });
      }
    }
  }

  const storedArtifacts = buffers.length ? await storeOutputs(jobId, buffers) : inlineArtifacts;

  if (!storedArtifacts.length) {
    metrics.record('provider.seedream.error', 1, { reason: 'no_output' });
    throw new Error('Seedream response did not contain image output');
  }

  return {
    status: 'succeeded',
    artifacts: storedArtifacts,
    providerMeta: {
      endpoint,
      modelId,
      responseId: payload.id
    }
  };
};
