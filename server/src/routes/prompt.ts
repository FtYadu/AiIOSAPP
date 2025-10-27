import { Router } from 'express';
import { z } from 'zod';

import { remoteConfig } from '@lib/remoteConfig';

const promptSchema = z.object({
  intent: z.string().min(1),
  context: z
    .object({
      boxes: z.number().int().optional(),
      provider: z.string().optional()
    })
    .optional()
});

export const promptRouter = Router();

promptRouter.post('/suggest', async (req, res, next) => {
  try {
    const { intent, context } = promptSchema.parse(req.body);

    const cleanedIntent = intent.trim();
    const providerHint = context?.provider ?? 'openai';
    const providerConfig = await remoteConfig.getProvider(providerHint);
    const safetyTag = providerConfig?.safetyLevel ?? 'balanced';
    const boxCount = context?.boxes ?? 0;
    const boxesPrefix = boxCount > 0 ? 'apply only inside marked region: ' : '';

    const suggestions = [
      `${boxesPrefix}${cleanedIntent} with cinematic lighting`,
      `${boxesPrefix}${cleanedIntent} with soft shadows`,
      `${boxesPrefix}${cleanedIntent} preserving subject skin tone`
    ];

    const guidanceRange = providerConfig?.guidanceRange ?? [0, 1];
    const guidance = Number(((guidanceRange[0] + guidanceRange[1]) / 2).toFixed(2));

    return res.json({
      provider: providerHint,
      suggestions,
      safetyLevel: safetyTag,
      tokens: {
        guidance,
        strength: 0.5
      }
    });
  } catch (error) {
    return next(error);
  }
});
