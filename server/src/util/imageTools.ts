import sharp from 'sharp';

export const cropToAspect = async (input: Buffer, targetWidth: number, targetHeight: number): Promise<Buffer> => {
  return sharp(input)
    .resize(targetWidth, targetHeight, {
      fit: 'cover',
      position: 'center'
    })
    .toBuffer();
};

export const createPolygonMask = async (
  width: number,
  height: number,
  points: Array<{ x: number; y: number }>
): Promise<Buffer> => {
  const svgPoints = points.map((point) => `${point.x * width},${point.y * height}`).join(' ');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><polygon points="${svgPoints}" fill="white" /></svg>`;

  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toBuffer();
};
