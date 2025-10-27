import { Router } from 'express';
import { z } from 'zod';

const blendSchema = z.object({
  providerAJobId: z.string().uuid(),
  providerBJobId: z.string().uuid(),
  mode: z.enum(['soft-light', 'luminosity', 'average']).default('soft-light')
});

export const blendRouter = Router();

blendRouter.post('/', (req, res, next) => {
  try {
    const payload = blendSchema.parse(req.body);
    return res.json({
      jobId: `blend-${payload.providerAJobId}-${payload.providerBJobId}`,
      status: 'succeeded',
      artifacts: [
        {
          url: 'stub://blend/output.png',
          mime: 'image/png'
        }
      ],
      providerMeta: { mode: payload.mode }
    });
  } catch (error) {
    return next(error);
  }
});
