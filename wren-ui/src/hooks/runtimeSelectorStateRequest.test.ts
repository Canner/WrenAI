import {
  buildRuntimeSelectorStateUrl,
  clearRuntimeSelectorStateCache,
  fetchRuntimeSelectorState,
  peekRuntimeSelectorStatePayload,
  primeRuntimeSelectorStatePayload,
} from './runtimeSelectorStateRequest';

describe('runtimeSelectorStateRequest cache helpers', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    clearRuntimeSelectorStateCache();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    clearRuntimeSelectorStateCache();
    global.fetch = originalFetch;
  });

  it('builds the runtime selector endpoint with scope params', () => {
    expect(
      buildRuntimeSelectorStateUrl({
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snap-1',
        deployHash: 'deploy-1',
      }),
    ).toBe(
      '/api/v1/runtime/scope/current?workspaceId=workspace-1&knowledgeBaseId=kb-1&kbSnapshotId=snap-1&deployHash=deploy-1',
    );
  });

  it('deduplicates runtime selector requests and caches the resolved payload', async () => {
    const payload = {
      currentWorkspace: {
        id: 'workspace-1',
        slug: 'workspace-1',
        name: 'Workspace 1',
      },
      workspaces: [],
      currentKnowledgeBase: null,
      currentKbSnapshot: null,
      knowledgeBases: [],
      kbSnapshots: [],
    };
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response(JSON.stringify(payload), { status: 200 }),
    );

    const requestUrl = '/api/v1/runtime/scope/current?workspaceId=workspace-1';
    const [firstPayload, secondPayload] = await Promise.all([
      fetchRuntimeSelectorState({
        requestUrl,
        signal: new AbortController().signal,
      }),
      fetchRuntimeSelectorState({
        requestUrl,
        signal: new AbortController().signal,
      }),
    ]);

    expect(firstPayload).toEqual(payload);
    expect(secondPayload).toEqual(payload);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(peekRuntimeSelectorStatePayload({ requestUrl })).toEqual(payload);
  });

  it('retries transient runtime scope failures before rejecting', async () => {
    const payload = {
      currentWorkspace: {
        id: 'workspace-1',
        slug: 'workspace-1',
        name: 'Workspace 1',
      },
      workspaces: [],
      currentKnowledgeBase: null,
      currentKbSnapshot: null,
      knowledgeBases: [],
      kbSnapshots: [],
    };
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: 'Session workspace does not match requested workspace',
          }),
          { status: 500 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(payload), { status: 200 }),
      );

    const requestUrl = '/api/v1/runtime/scope/current?workspaceId=workspace-1';
    await expect(
      fetchRuntimeSelectorState({
        requestUrl,
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual(payload);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('can prime runtime selector payloads before the hook requests them', () => {
    const requestUrl = '/api/v1/runtime/scope/current?workspaceId=workspace-1';
    const payload = {
      currentWorkspace: {
        id: 'workspace-1',
        slug: 'workspace-1',
        name: 'Workspace 1',
      },
      workspaces: [],
      currentKnowledgeBase: null,
      currentKbSnapshot: null,
      knowledgeBases: [],
      kbSnapshots: [],
    };

    primeRuntimeSelectorStatePayload({
      requestUrl,
      payload,
    });

    expect(peekRuntimeSelectorStatePayload({ requestUrl })).toEqual(payload);
  });
});
