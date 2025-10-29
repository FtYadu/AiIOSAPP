import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

import { runtimeConfig } from '@config/env';

type MetricDefinition = {
  help: string;
  labelNames: string[];
};

const register = new Registry();

if (runtimeConfig.metricsEnabled) {
  collectDefaultMetrics({ register });
}

const metricDefinitions = new Map<string, MetricDefinition>([
  ['providers.reload', { help: 'Provider registry reload count', labelNames: [] }],
  ['providers.enqueue', { help: 'Jobs enqueued per provider', labelNames: ['provider'] }],
  ['provider.seedream.invoke', { help: 'Seedream invocation count', labelNames: ['hasImage'] }],
  [
    'provider.seedream.error',
    { help: 'Seedream executor errors', labelNames: ['status', 'reason'] }
  ],
  ['provider.openai.invoke', { help: 'OpenAI invocation count', labelNames: ['mode'] }],
  [
    'provider.openai.download_error',
    { help: 'OpenAI asset download errors', labelNames: ['provider'] }
  ],
  ['provider.openai.error', { help: 'OpenAI executor errors', labelNames: ['mode'] }],
  ['provider.gemini.invoke', { help: 'Gemini invocation count', labelNames: ['hasImage'] }],
  [
    'provider.gemini.error',
    { help: 'Gemini executor errors', labelNames: ['status', 'reason'] }
  ],
  ['provider.reimagine.invoke', { help: 'Reimagine invocation count', labelNames: [] }],
  [
    'routes.image_edits.accepted',
    { help: 'Image edits accepted via API', labelNames: ['provider'] }
  ],
  ['routes.image_edits.error', { help: 'Image edit route errors', labelNames: [] }],
  ['routes.jobs.missing', { help: 'Job fetch misses', labelNames: [] }],
  [
    'routes.jobs.fetched',
    { help: 'Job fetch hits', labelNames: ['provider', 'status'] }
  ],
  ['routes.edits.accepted', { help: 'Legacy edits accepted', labelNames: ['provider'] }],
  ['routes.edits.error', { help: 'Legacy edit errors', labelNames: [] }],
  [
    'queue.enqueue',
    { help: 'Jobs queued for execution', labelNames: ['provider', 'transport'] }
  ],
  [
    'queue.job.success',
    {
      help: 'Jobs completed successfully',
      labelNames: ['provider', 'transport']
    }
  ],
  [
    'queue.job.failure',
    {
      help: 'Jobs that failed after execution attempt',
      labelNames: ['provider', 'transport', 'error_tag']
    }
  ],
  [
    'queue.mask.uploads',
    { help: 'Mask uploads accepted for edits', labelNames: ['provider'] }
  ],
  [
    'webhook.dispatch.failures',
    { help: 'Failed webhook dispatch attempts', labelNames: ['provider', 'status'] }
  ]
]);

const counters = new Map<string, Counter<string>>();
const histograms = new Map<string, Histogram<string>>();
const sanitizedNames = new Map<string, string>();

const sanitizeMetricName = (name: string): string => {
  const cached = sanitizedNames.get(name);
  if (cached) {
    return cached;
  }

  let candidate = name.replace(/[^a-zA-Z0-9_]/g, '_');
  if (!/^[a-zA-Z_]/.test(candidate)) {
    candidate = `imagen_${candidate}`;
  }

  sanitizedNames.set(name, candidate);
  return candidate;
};

const applyLabels = (
  labelNames: string[],
  tags: Record<string, string> | undefined
): Record<string, string> => {
  const result: Record<string, string> = {};
  for (const label of labelNames) {
    if (tags?.[label] !== undefined && tags[label] !== null) {
      result[label] = String(tags[label]);
    } else {
      result[label] = 'none';
    }
  }
  return result;
};

const ensureCounter = (name: string, tags?: Record<string, string>): Counter<string> => {
  const metricName = sanitizeMetricName(name);
  let counter = counters.get(metricName);
  if (counter) {
    return counter;
  }

  const definition = metricDefinitions.get(name) ?? {
    help: `${name} counter`,
    labelNames: Object.keys(tags ?? {})
  };

  counter = new Counter({
    name: metricName,
    help: definition.help,
    labelNames: definition.labelNames,
    registers: runtimeConfig.metricsEnabled ? [register] : []
  });

  counters.set(metricName, counter);
  metricDefinitions.set(name, definition);
  return counter;
};

const ensureHistogram = (name: string, definition: MetricDefinition): Histogram<string> => {
  const metricName = sanitizeMetricName(name);
  let histogram = histograms.get(metricName);
  if (histogram) {
    return histogram;
  }

  histogram = new Histogram({
    name: metricName,
    help: definition.help,
    labelNames: definition.labelNames,
    buckets: [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 20, 30, 60, 120],
    registers: runtimeConfig.metricsEnabled ? [register] : []
  });

  histograms.set(metricName, histogram);
  return histogram;
};

const queueLatencyHistogram = ensureHistogram('queue.latency_seconds', {
  help: 'Latency between enqueue and completion in seconds',
  labelNames: ['provider', 'transport', 'outcome']
});

const maskUploadsCounter = ensureCounter('queue.mask.uploads', { provider: '' });
const webhookFailureCounter = ensureCounter('webhook.dispatch.failures', {
  provider: '',
  status: ''
});

export const metrics = {
  record(name: string, value = 1, tags?: Record<string, string>): void {
    const counter = ensureCounter(name, tags);
    const definition = metricDefinitions.get(name);
    const labels = applyLabels(definition?.labelNames ?? [], tags);
    counter.inc(labels, value);
  },
  observeQueueLatency(
    provider: string,
    transport: string,
    durationMs: number,
    outcome: 'success' | 'failure'
  ): void {
    const seconds = durationMs / 1000;
    queueLatencyHistogram.observe(
      applyLabels(['provider', 'transport', 'outcome'], {
        provider,
        transport,
        outcome
      }),
      seconds
    );
  },
  incrementMaskUpload(provider: string): void {
    maskUploadsCounter.inc({ provider });
  },
  recordWebhookFailure(provider: string, status: string): void {
    webhookFailureCounter.inc({ provider, status });
  },
  isEnabled(): boolean {
    return runtimeConfig.metricsEnabled;
  },
  async export(): Promise<string> {
    if (!runtimeConfig.metricsEnabled) {
      return '# metrics disabled\n';
    }
    return register.metrics();
  },
  contentType: register.contentType
};

export type Metrics = typeof metrics;
export { register as metricsRegistry };
