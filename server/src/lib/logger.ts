import pino from 'pino';

import { runtimeConfig } from '@config/env';

export const logger = pino({
  level: runtimeConfig.logLevel,
  base: {
    service: 'imagen-gateway'
  }
});

export type Logger = typeof logger;

export const createLogger = (bindings: pino.Bindings) => logger.child(bindings);
