import { Router } from 'express';

import { metrics } from '@lib/metrics';
import { findJobWithOutputs } from '@lib/jobRepository';
import { validate as uuidValidate } from 'uuid';

export const jobsRouter = Router();

jobsRouter.get('/:jobId', async (req, res) => {
  if (!uuidValidate(req.params.jobId)) {
    metrics.record('routes.jobs.missing', 1);
    return res.status(404).json({ error: 'Job not found' });
  }
  const record = await findJobWithOutputs(req.params.jobId);
  if (!record) {
    metrics.record('routes.jobs.missing', 1);
    return res.status(404).json({ error: 'Job not found' });
  }

  metrics.record('routes.jobs.fetched', 1, {
    provider: record.job.provider ?? 'unknown',
    status: record.job.status
  });

  const artifacts = record.outputs.map((asset) => ({
    url: asset.public_url ?? asset.storage_path,
    mime: asset.mime ?? 'image/png',
    sha256: asset.sha256 ?? undefined,
    width: asset.width ?? undefined,
    height: asset.height ?? undefined
  }));

  return res.json({
    jobId: record.job.id,
    provider: record.job.provider,
    status: record.job.status,
    artifacts,
    providerMeta: record.job.metadata ?? {},
    updatedAt: record.job.updated_at
  });
});
