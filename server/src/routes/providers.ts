import { Router } from 'express';

import { remoteConfig } from '@lib/remoteConfig';
import { listProviders, reloadProviders } from '@providers/providerRegistry';

export const providersRouter = Router();

providersRouter.get('/', async (_req, res) => {
  const configs = await remoteConfig.listProviders();
  return res.json({
    providers: configs
      .filter((config) => config.enabled)
      .map((config) => ({
        name: config.name,
        endpoint: config.endpoint,
        modelId: config.modelId,
        safetyLevel: config.safetyLevel,
        supportsBoxes: config.supportsBoxes,
        supportsUpscale: config.supportsUpscale,
        guidanceRange: config.guidanceRange
      }))
  });
});

providersRouter.post('/reload', async (_req, res) => {
  await reloadProviders();
  const providers = await listProviders();
  return res.status(202).json({ ok: true, providers });
});
