import {
  clearAuthSessionCache,
  loadAuthSessionPayload,
  prefetchAuthSessionPayload,
} from './useAuthSession';

const authenticatedPayload = {
  authenticated: true,
  user: { id: 'user-1', email: 'admin@example.com' },
  workspace: { id: 'workspace-1', name: 'Workspace 1' },
  runtimeSelector: {
    workspaceId: 'workspace-1',
    knowledgeBaseId: 'kb-1',
    kbSnapshotId: 'snap-1',
    deployHash: 'deploy-1',
  },
};

describe('useAuthSession shared loader', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearAuthSessionCache();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => authenticatedPayload,
    } as Response);
  });

  it('reuses the in-flight auth session request and caches the resolved payload', async () => {
    const sessionArgs = {
      sessionCacheKey: 'workspace:workspace-1',
      workspaceId: 'workspace-1',
    };

    const [first, second] = await Promise.all([
      loadAuthSessionPayload(sessionArgs),
      loadAuthSessionPayload(sessionArgs),
    ]);

    expect(first).toEqual(authenticatedPayload);
    expect(second).toEqual(authenticatedPayload);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/auth/session?workspaceId=workspace-1',
      {
        credentials: 'include',
      },
    );

    const cached = await loadAuthSessionPayload(sessionArgs);

    expect(cached).toEqual(authenticatedPayload);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('warms the auth session cache ahead of hook usage', async () => {
    prefetchAuthSessionPayload({
      workspaceId: 'workspace-1',
    });

    const payload = await loadAuthSessionPayload({
      sessionCacheKey: 'workspace:workspace-1',
      workspaceId: 'workspace-1',
    });

    expect(payload).toEqual(authenticatedPayload);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/auth/session?workspaceId=workspace-1',
      {
        credentials: 'include',
      },
    );
  });

  it('supports loading the global auth session without workspace scope', async () => {
    const payload = await loadAuthSessionPayload({
      sessionCacheKey: 'global',
    });

    expect(payload).toEqual(authenticatedPayload);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith('/api/auth/session', {
      credentials: 'include',
    });
  });
});
