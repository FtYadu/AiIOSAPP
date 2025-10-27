import { Buffer } from 'node:buffer';

import { fetch, FormData, File } from 'undici';

import { metrics } from '@lib/metrics';
import { ProviderConfig } from '@lib/remoteConfig';
import { ImageEditRequest, ImageEditResult } from '@providers/types';

import { computeSha256, loadImageBuffer, toDataUrl, requireEnv } from './helpers';
import { downloadToBuffer } from '@util/http';
import { formatToMime, storeOutputs, OutputBuffer, ImageFormat } from '@util/storeOutputs';

const OPENAI_DEFAULT_BASE = 'https://api.openai.com/v1';

const serializeSize = (size?: ImageEditRequest['size']): string => {
  if (!size) {
    return '1024x1024';
  }

  const candidate = `${size.w}x${size.h}`;
  const allowed = new Set(['1024x1024', '1024x1792', '1792x1024']);
  return allowed.has(candidate) ? candidate : '1024x1024';
};

const normalizeOutputs = (
  payload: { b64_json?: string; url?: string }[] = [],
  mimeType = 'image/png'
) =>
  payload
    .map((item) => {
      if (item.url) {
        return {
          url: item.url,
          mime: mimeType
        };
      }
      if (item.b64_json) {
        const buffer = Buffer.from(item.b64_json, 'base64');
        return {
          url: toDataUrl(mimeType, item.b64_json),
          mime: mimeType,
          sha256: computeSha256(buffer)
        };
      }
      return undefined;
    })
    .filter((artifact): artifact is { url: string; mime: string; sha256?: string } => Boolean(artifact));

export const handleOpenAIEdit = async (
  jobId: string,
  request: ImageEditRequest,
  config: ProviderConfig
): Promise<ImageEditResult> => {
  metrics.record('provider.openai.invoke', 1, { mode: request.baseImage ? 'edit' : 'generate' });

  const apiKey = requireEnv('OPENAI_API_KEY');
  const baseUrl = config.endpoint || OPENAI_DEFAULT_BASE;
  const modelId = config.modelId || 'gpt-image-1';
  const size = serializeSize(request.size);

  const defaultFormat: ImageFormat = request.format ?? 'png';

  try {
    if (!request.baseImage) {
      const response = await fetch(`${baseUrl}/images/generations`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: modelId,
          prompt: request.prompt,
          size,
          response_format: 'b64_json',
          n: 1
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI generation failed: ${response.status} ${errorText}`);
      }

      const payload = (await response.json()) as {
        created: number;
        data: Array<{ b64_json?: string; url?: string }>;
      };

      const buffers: OutputBuffer[] = [];
      for (const item of payload.data) {
        if (item.b64_json) {
          const buffer = Buffer.from(item.b64_json, 'base64');
          buffers.push({ buffer, format: defaultFormat, mime: formatToMime(defaultFormat) });
        } else if (item.url) {
          try {
            const downloaded = await downloadToBuffer(item.url);
            const mime = downloaded.mimeType;
            const format = mime.includes('jpeg') || mime.includes('jpg') ? 'jpeg' : mime.includes('webp') ? 'webp' : defaultFormat;
            buffers.push({ buffer: downloaded.buffer, format, mime });
          } catch (error) {
            metrics.record('provider.openai.download_error', 1, {
              provider: 'openai'
            });
          }
        }
      }

      const inlineArtifacts = normalizeOutputs(payload.data, formatToMime(defaultFormat));
      const storedArtifacts = buffers.length ? await storeOutputs(jobId, buffers) : inlineArtifacts;

      return {
        status: 'succeeded',
        artifacts: storedArtifacts,
        providerMeta: {
          created: payload.created,
          modelId,
          size,
          endpoint: baseUrl
        }
      };
    }

    const { buffer, contentType } = await loadImageBuffer(request.baseImage);
    const form = new FormData();
    form.append('model', modelId);
    form.append('prompt', request.prompt);
    form.append('image', new File([buffer], 'image.png', { type: contentType }));
    form.append('response_format', 'b64_json');
    form.append('n', '1');
    form.append('size', size);

    const response = await fetch(`${baseUrl}/images/edits`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`
      },
      body: form as any
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI edit failed: ${response.status} ${errorText}`);
    }

    const payload = (await response.json()) as {
      created: number;
      data: Array<{ b64_json?: string; url?: string }>;
    };

    const buffers: OutputBuffer[] = [];

    for (const item of payload.data) {
      if (item.b64_json) {
        const baseBuffer = Buffer.from(item.b64_json, 'base64');
        const format = contentType?.includes('jpeg') ? 'jpeg' : contentType?.includes('webp') ? 'webp' : defaultFormat;
        buffers.push({ buffer: baseBuffer, format, mime: contentType ?? formatToMime(format) });
      } else if (item.url) {
        try {
          const downloaded = await downloadToBuffer(item.url);
          const format = downloaded.mimeType.includes('jpeg') || downloaded.mimeType.includes('jpg')
            ? 'jpeg'
            : downloaded.mimeType.includes('webp')
              ? 'webp'
              : defaultFormat;
          buffers.push({ buffer: downloaded.buffer, format, mime: downloaded.mimeType });
        } catch (error) {
          metrics.record('provider.openai.download_error', 1, {
            provider: 'openai'
          });
        }
      }
    }

    const inlineArtifacts = normalizeOutputs(payload.data, contentType ?? 'image/png');
    const storedArtifacts = buffers.length ? await storeOutputs(jobId, buffers) : inlineArtifacts;

    return {
      status: 'succeeded',
      artifacts: storedArtifacts,
      providerMeta: {
        created: payload.created,
        modelId,
        size,
        endpoint: baseUrl,
        maskApplied: Boolean(request.boxes?.length)
      }
    };
  } catch (error) {
    metrics.record('provider.openai.error', 1, { mode: request.baseImage ? 'edit' : 'generate' });
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('OpenAI executor encountered an unknown error');
  }
};
