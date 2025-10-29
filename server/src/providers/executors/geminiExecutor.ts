import { Buffer } from 'node:buffer';

import { fetch } from 'undici';

import { metrics } from '@lib/metrics';
import { ProviderConfig } from '@lib/remoteConfig';
import { ImageEditRequest, ImageEditResult } from '@providers/types';

import { buildStubResult, loadImageBuffer, toDataUrl, requireEnv, computeSha256 } from './helpers';
import { downloadToBuffer } from '@util/http';
import { storeOutputs, OutputBuffer } from '@util/storeOutputs';

const DEFAULT_MODEL = 'gemini-2.5-flash-image';

type GeminiPart =
  | { text: string }
  | { inline_data: { mime_type: string; data: string } };

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: GeminiPart[];
    };
  }>;
};

export const handleGeminiEdit = async (
  jobId: string,
  request: ImageEditRequest,
  config: ProviderConfig
): Promise<ImageEditResult> => {
  metrics.record('provider.gemini.invoke', 1, { hasImage: String(Boolean(request.baseImage)) });

  if (process.env.PROVIDER_STUBS === 'true') {
    return buildStubResult('gemini', request, {
      providerMeta: {
        stub: true
      }
    });
  }

  const apiKey = requireEnv('GEMINI_API_KEY');
  const modelId = config.modelId || DEFAULT_MODEL;
  const endpoint =
    config.endpoint ||
    `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;

  const parts: GeminiPart[] = [];
  let contentType = 'image/png';

  if (request.baseImage) {
    const image = await loadImageBuffer(request.baseImage);
    parts.push({ inline_data: { mime_type: image.contentType, data: image.buffer.toString('base64') } });
    contentType = image.contentType;
  }

  parts.push({ text: request.prompt });

  const body = {
    contents: [
      {
        role: 'user',
        parts
      }
    ],
    generationConfig: {
      temperature: request.guidance ?? 0.7,
      responseMimeType: 'image/png'
    }
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorText = await response.text();
    metrics.record('provider.gemini.error', 1, { status: String(response.status) });
    throw new Error(`Gemini request failed: ${response.status} ${errorText}`);
  }

  const payload = (await response.json()) as GeminiResponse;
  const inlineArtifacts: Array<{ url: string; mime: string; sha256?: string }> = [];
  const buffers: OutputBuffer[] = [];

  for (const candidate of payload.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      if ('inline_data' in part && part.inline_data?.data) {
        const mime = part.inline_data.mime_type ?? contentType;
        const buffer = Buffer.from(part.inline_data.data, 'base64');
        buffers.push({
          buffer,
          format: mime.includes('jpeg') ? 'jpeg' : mime.includes('webp') ? 'webp' : 'png',
          mime
        });
        inlineArtifacts.push({ url: toDataUrl(mime, part.inline_data.data), mime, sha256: computeSha256(buffer) });
      } else if ('url' in part && (part as unknown as { url?: string }).url) {
        const url = (part as unknown as { url: string }).url;
        const downloaded = await downloadToBuffer(url);
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
          url,
          mime: downloaded.mimeType,
          sha256: computeSha256(downloaded.buffer)
        });
      }
    }
  }

  const storedArtifacts = buffers.length ? await storeOutputs(jobId, buffers) : inlineArtifacts;

  if (!storedArtifacts.length) {
    metrics.record('provider.gemini.error', 1, { reason: 'no_output' });
    throw new Error('Gemini response did not include inline image data');
  }

  return {
    status: 'succeeded',
    artifacts: storedArtifacts,
    providerMeta: {
      endpoint,
      modelId,
      supportsBoxes: config.supportsBoxes,
      promptTokens: undefined
    }
  };
};
