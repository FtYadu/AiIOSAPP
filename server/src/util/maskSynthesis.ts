import sharp from 'sharp';

import { ImageEditRequest } from '@providers/types';

import { loadImageBuffer } from '@providers/executors/helpers';
import { createPolygonMask } from './imageTools';

const clamp = (value: number): number => {
  if (Number.isNaN(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
};

const DEFAULT_DIMENSION = 1024;

const inferDimensions = async (request: ImageEditRequest): Promise<{ width: number; height: number }> => {
  if (request.baseImage) {
    try {
      const base = await loadImageBuffer(request.baseImage);
      const metadata = await sharp(base.buffer).metadata();
      const width = metadata.width ?? request.size?.w ?? DEFAULT_DIMENSION;
      const height = metadata.height ?? request.size?.h ?? DEFAULT_DIMENSION;
      return { width, height };
    } catch {
      // Fallback to provided size or defaults when metadata lookup fails.
    }
  }

  return {
    width: request.size?.w ?? DEFAULT_DIMENSION,
    height: request.size?.h ?? DEFAULT_DIMENSION
  };
};

type Box = NonNullable<ImageEditRequest['boxes']>[number];

const buildPolygonPoints = (box: Box) => {
  const x1 = clamp(box.x);
  const y1 = clamp(box.y);
  const x2 = clamp(box.x + box.w);
  const y2 = clamp(box.y + box.h);

  return [
    { x: x1, y: y1 },
    { x: x2, y: y1 },
    { x: x2, y: y2 },
    { x: x1, y: y2 }
  ];
};

export const ensureMaskFromBoxes = async (request: ImageEditRequest): Promise<ImageEditRequest> => {
  if (request.maskImage || !request.boxes?.length) {
    return request;
  }

  const { width, height } = await inferDimensions(request);

  const overlays = await Promise.all(
    request.boxes.map(async (box) => {
      const points = buildPolygonPoints(box);
      return createPolygonMask(width, height, points);
    })
  );

  if (!overlays.length) {
    return request;
  }

  const composite = sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  }).composite(overlays.map((buffer) => ({ input: buffer, top: 0, left: 0 })));

  const buffer = await composite.png().toBuffer();

  return {
    ...request,
    maskImage: `data:image/png;base64,${buffer.toString('base64')}`
  };
};
