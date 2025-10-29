import { runtimeConfig } from '@config/env';

const MAX_DELAY_MS = 30_000;

export const computeBackoffDelay = (attempt: number): number => {
  const base = runtimeConfig.queueInitialBackoffMs;
  const next = base * 2 ** attempt;
  return Math.min(next, MAX_DELAY_MS);
};

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (typeof timer === 'object' && typeof timer.unref === 'function') {
      timer.unref();
    }
  });
