import { executeProviderJob } from '@workers/providerWorker';
import { ProviderConfig } from '@lib/remoteConfig';

jest.mock('@providers/executors/registry', () => ({
  resolveExecutor: jest.fn()
}));

const resolveExecutor = jest.requireMock('@providers/executors/registry').resolveExecutor as jest.Mock;

describe('executeProviderJob', () => {
  const config: ProviderConfig = {
    name: 'reimagine',
    endpoint: 'https://api.example.com',
    modelId: 'reimagine-edit',
    safetyLevel: 'balanced',
    enabled: true,
    supportsBoxes: true,
    supportsUpscale: true,
    guidanceRange: [0, 1]
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('synthesizes a mask before invoking the executor', async () => {
    const executorMock = jest.fn(async (_jobId: string, request: any) => ({
      status: 'succeeded',
      artifacts: [],
      providerMeta: {
        mask: request.maskImage
      }
    }));
    resolveExecutor.mockReturnValue(executorMock);

    const result = await executeProviderJob(
      { provider: 'reimagine', retries: 1, config, jobId: 'job-1' },
      {
        prompt: 'add clouds',
        size: { w: 128, h: 128 },
        boxes: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.25 }]
      }
    );

    expect(executorMock).toHaveBeenCalledTimes(1);
    const [, requestArg] = executorMock.mock.calls[0];
    expect(requestArg.maskImage).toMatch(/^data:image\/png;base64,/);
    expect(result.providerMeta).toMatchObject({
      retries: 1,
      config
    });
  });
});
