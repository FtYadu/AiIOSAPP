import { Buffer } from 'node:buffer';

import { fetch } from 'undici';

import { handleReimagineEdit } from '@providers/executors/reimagineExecutor';
import { ProviderConfig } from '@lib/remoteConfig';
import { storeOutputs } from '@util/storeOutputs';

jest.mock('undici', () => ({
  fetch: jest.fn()
}));

jest.mock('@util/storeOutputs', () => {
  const actual = jest.requireActual('../src/util/storeOutputs');
  return {
    ...actual,
    storeOutputs: jest.fn(async (_jobId: string, outputs: any[]) =>
      outputs.map((output, index) => ({
        url: `https://cdn.local/jobs/output-${index}.png`,
        storagePath: `reimagine-outputs/job-${index}.png`,
        mime: output.mime,
        sha256: `hash-${index}`,
        width: 512,
        height: 512
      }))
    )
  };
});

const fetchMock = jest.mocked(fetch);
const storeOutputsMock = jest.mocked(storeOutputs);

describe('handleReimagineEdit', () => {
  const config: ProviderConfig = {
    name: 'reimagine',
    endpoint: 'https://api.example.com',
    modelId: 'eternal-edit-v1',
    safetyLevel: 'balanced',
    enabled: true,
    supportsBoxes: true,
    supportsUpscale: true,
    guidanceRange: [0, 1]
  };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.REIMAGINE_API_KEY = 'test-key';
  });

  it('submits edits, polls until completion, and stores outputs', async () => {
    const base64 = Buffer.from('fake-image').toString('base64');

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ id: 'job-123', status: 'running' }),
      text: async () => ''
    } as any);

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'job-123',
        status: 'succeeded',
        artifacts: [
          {
            base64,
            mime: 'image/png',
            width: 640,
            height: 480
          }
        ]
      }),
      text: async () => ''
    } as any);

    const result = await handleReimagineEdit(
      'job-123',
      {
        prompt: 'make it futuristic',
        baseImage: `data:image/png;base64,${base64}`,
        maskImage: `data:image/png;base64,${base64}`
      },
      config
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const submitCall = fetchMock.mock.calls[0];
    expect(submitCall[0]).toBe('https://api.example.com/v1/edits');
    const headers = submitCall[1]?.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer test-key');
    expect(storeOutputsMock).toHaveBeenCalledWith(
      'job-123',
      expect.arrayContaining([
        expect.objectContaining({ mime: 'image/png' })
      ])
    );
    expect(result.status).toBe('succeeded');
    expect(result.artifacts[0]).toMatchObject({
      url: 'https://cdn.local/jobs/output-0.png',
      storagePath: 'reimagine-outputs/job-0.png',
      mime: 'image/png'
    });
  });
});
