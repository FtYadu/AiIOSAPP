import { Router } from 'express';
import { z } from 'zod';

import { metrics } from '@lib/metrics';
import { getProvider } from '@providers/providerRegistry';

const editSchema = z.object({
  provider: z.string().min(1),
  imageRef: z.string().min(1),
  prompt: z.string().min(1),
  boxes: z
    .array(
      z.object({
        x: z.number(),
        y: z.number(),
        w: z.number().positive(),
        h: z.number().positive(),
        label: z.string().optional()
      })
    )
    .optional(),
  strength: z.number().min(0).max(1).optional(),
  guidance: z.number().min(0).max(30).optional(),
  seed: z.number().int().optional(),
  size: z
    .object({
      w: z.number().int().positive(),
      h: z.number().int().positive()
    })
    .optional()
});

export const editsRouter = Router();

editsRouter.post('/', async (req, res, next) => {
  try {
    const parsed = editSchema.parse(req.body);
    const provider = await getProvider(parsed.provider);

    if (!provider) {
      return res.status(404).json({ error: `Provider ${parsed.provider} not available` });
    }

    const userId = req.header('x-user-id') ?? '00000000-0000-0000-0000-000000000000';

    const job = await provider.enqueueEdit({
      baseImage: parsed.imageRef,
      prompt: parsed.prompt,
      boxes: parsed.boxes,
      guidance: parsed.guidance,
      strength: parsed.strength,
      seed: parsed.seed,
      size: parsed.size
    }, { userId, prompt: parsed.prompt });

    metrics.record('routes.edits.accepted', 1, { provider: parsed.provider });

    return res.status(202).json({ jobId: job.jobId });
  } catch (error) {
    metrics.record('routes.edits.error', 1);
    return next(error);
  }
});
