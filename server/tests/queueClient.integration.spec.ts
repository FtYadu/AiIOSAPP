import { queueClient } from '@lib/queueClient';
import { appendArtifacts, updateJobStatus } from '@lib/jobRepository';
import { dispatchJobWebhook } from '@lib/webhookDispatcher';
import { executeProviderJob } from '@workers/providerWorker';

jest.mock('@lib/jobRepository', () => ({
  appendArtifacts: jest.fn(),
  updateJobStatus: jest.fn()
}));

jest.mock('@workers/providerWorker', () => ({
  executeProviderJob: jest.fn()
}));

jest.mock('@lib/webhookDispatcher', () => ({
  dispatchJobWebhook: jest.fn()
}));

const appendArtifactsMock = jest.mocked(appendArtifacts);
const updateJobStatusMock = jest.mocked(updateJobStatus);
const executeProviderJobMock = jest.mocked(executeProviderJob);
const dispatchJobWebhookMock = jest.mocked(dispatchJobWebhook);

describe('queueClient integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('executes jobs with synthesized masks, persists artifacts, and logs webhooks', async () => {
    executeProviderJobMock.mockImplementation(async (_context, request) => {
      expect(request.maskImage).toMatch(/^data:image\/png;base64,/);
      return {
        status: 'succeeded',
        artifacts: [
          {
            url: 'https://cdn.example.com/output.png',
            storagePath: 'reimagine-outputs/job/output.png',
            mime: 'image/png',
            sha256: 'hash',
            width: 1024,
            height: 1024
          }
        ],
        providerMeta: {}
      };
    });

    await queueClient.enqueue({
      jobId: 'job-123',
      provider: 'reimagine',
      request: {
        prompt: 'color grade to teal',
        size: { w: 64, h: 64 },
        boxes: [{ x: 0.2, y: 0.2, w: 0.4, h: 0.4 }]
      },
      config: {
        name: 'reimagine',
        endpoint: 'https://api.example.com',
        modelId: 'reimagine-edit',
        safetyLevel: 'balanced',
        enabled: true,
        supportsBoxes: true,
        supportsUpscale: true,
        guidanceRange: [0, 1]
      }
    });

    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(executeProviderJobMock).toHaveBeenCalledTimes(1);
    expect(appendArtifactsMock).toHaveBeenCalledWith(
      'job-123',
      expect.arrayContaining([
        expect.objectContaining({ storagePath: 'reimagine-outputs/job/output.png' })
      ])
    );
    expect(updateJobStatusMock).toHaveBeenCalledWith('job-123', 'succeeded');
    expect(dispatchJobWebhookMock).toHaveBeenCalledWith({
      jobId: 'job-123',
      status: 'succeeded',
      artifacts: expect.any(Array),
      error: null
    });
  });

  it('records failures and notifies webhooks', async () => {
    executeProviderJobMock.mockRejectedValueOnce(new Error('provider boom'));

    await queueClient.enqueue({
      jobId: 'job-456',
      provider: 'reimagine',
      request: {
        prompt: 'invert colors',
        boxes: [{ x: 0.1, y: 0.1, w: 0.2, h: 0.3 }]
      },
      config: {
        name: 'reimagine',
        endpoint: 'https://api.example.com',
        modelId: 'reimagine-edit',
        safetyLevel: 'balanced',
        enabled: true,
        supportsBoxes: true,
        supportsUpscale: true,
        guidanceRange: [0, 1]
      }
    });

    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(appendArtifactsMock).not.toHaveBeenCalled();
    expect(updateJobStatusMock).toHaveBeenCalledWith('job-456', 'failed', 'provider boom');
    expect(dispatchJobWebhookMock).toHaveBeenCalledWith({
      jobId: 'job-456',
      status: 'failed',
      artifacts: [],
      error: 'provider boom'
    });
  });
});
