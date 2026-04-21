import { fetchDeployStatus } from './modelingRest';

describe('modelingRest fetchDeployStatus', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('retries transient runtime scope failures before succeeding', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: 'No deployment found for the requested runtime scope',
          }),
          { status: 500 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 'SYNCRONIZED' }), {
          status: 200,
        }),
      );

    await expect(
      fetchDeployStatus({
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snap-1',
        deployHash: 'deploy-1',
      }),
    ).resolves.toEqual({ status: 'SYNCRONIZED' });

    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
