import express from 'express';
import pinoHttp from 'pino-http';

import { assetsRouter } from '@routes/assets';
import { blendRouter } from '@routes/blend';
import { editsRouter } from '@routes/edits';
import { jobsRouter } from '@routes/jobs';
import { promptRouter } from '@routes/prompt';
import { trendsRouter } from '@routes/trends';
import { providersRouter } from '@routes/providers';
import { runtimeConfig } from '@config/env';
import { imageEditsRouter } from '@routes/imageEdits';
import { uploadsRouter } from '@routes/uploads';

export const createApp = () => {
  const app = express();

  app.use(
    pinoHttp({
      level: runtimeConfig.logLevel
    })
  );
  app.use(express.json({ limit: '10mb' }));

  app.get('/healthz', (_req, res) => res.json({ ok: true }));

  app.use('/v1/edits', editsRouter);
  app.use('/v1/jobs', jobsRouter);
  app.use('/v1/prompt', promptRouter);
  app.use('/v1/images/edits', imageEditsRouter);
  app.use('/v1/uploads', uploadsRouter);
  app.use('/v1/assets', assetsRouter);
  app.use('/v1/trends', trendsRouter);
  app.use('/v1/providers', providersRouter);
  app.use('/v1/blend', blendRouter);

  // Centralized error handler.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use(
    (
      err: Error,
      req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      const logger = (req as unknown as { log?: { error?: (payload: unknown, msg?: string) => void } }).log;
      logger?.error?.({ err }, 'Request failed');
      return res.status(400).json({ error: err.message });
    }
  );

  return app;
};
