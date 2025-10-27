import { metrics } from '@lib/metrics';
import { ProviderConfig } from '@lib/remoteConfig';
import { ImageEditRequest, ImageEditResult } from '@providers/types';

import { buildStubResult, requireEnv } from './helpers';

export const handleReimagineEdit = async (
  _jobId: string,
  request: ImageEditRequest,
  config: ProviderConfig
): Promise<ImageEditResult> => {
  metrics.record('provider.reimagine.invoke', 1);

  // TODO: call Eternal AI Reimagine API with remote-config endpoints once agent creds exist.
  // Ensure annotation boxes map to provider-specific mask payload.

  const apiKey = requireEnv('REIMAGINE_API_KEY');

  return buildStubResult('reimagine', request, {
    providerMeta: {
      endpoint: config.endpoint,
      safetyLevel: config.safetyLevel,
      credential: 'env:REIMAGINE_API_KEY',
      credentialLoaded: Boolean(apiKey)
    }
  });
};
