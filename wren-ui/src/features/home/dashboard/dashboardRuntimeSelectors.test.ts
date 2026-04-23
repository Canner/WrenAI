import { resolveDashboardBoundSelector } from './dashboardRuntimeSelectors';

describe('dashboardRuntimeSelectors', () => {
  it('prefers dashboard runtime binding over the fallback selector', () => {
    expect(
      resolveDashboardBoundSelector({
        workspaceSelector: { workspaceId: 'ws-1' },
        dashboard: {
          knowledgeBaseId: 'kb-dashboard',
          kbSnapshotId: 'snap-dashboard',
          deployHash: 'deploy-dashboard',
        },
        fallbackSelector: {
          workspaceId: 'ws-1',
          knowledgeBaseId: 'kb-fallback',
          kbSnapshotId: 'snap-fallback',
          deployHash: 'deploy-fallback',
        },
      }),
    ).toEqual({
      workspaceId: 'ws-1',
      knowledgeBaseId: 'kb-dashboard',
      kbSnapshotId: 'snap-dashboard',
      deployHash: 'deploy-dashboard',
    });
  });

  it('falls back to the current runtime selector when dashboard binding is absent', () => {
    expect(
      resolveDashboardBoundSelector({
        workspaceSelector: { workspaceId: 'ws-1' },
        dashboard: null,
        fallbackSelector: {
          workspaceId: 'ws-1',
          knowledgeBaseId: 'kb-fallback',
          kbSnapshotId: 'snap-fallback',
          deployHash: 'deploy-fallback',
        },
      }),
    ).toEqual({
      workspaceId: 'ws-1',
      knowledgeBaseId: 'kb-fallback',
      kbSnapshotId: 'snap-fallback',
      deployHash: 'deploy-fallback',
    });
  });

  it('keeps the workspace selector for workspace-scoped dashboards even when the page has a runtime fallback', () => {
    expect(
      resolveDashboardBoundSelector({
        workspaceSelector: { workspaceId: 'ws-1' },
        dashboard: {},
        fallbackSelector: {
          workspaceId: 'ws-1',
          knowledgeBaseId: 'kb-fallback',
          kbSnapshotId: 'snap-fallback',
          deployHash: 'deploy-fallback',
        },
      }),
    ).toEqual({ workspaceId: 'ws-1' });
  });

  it('keeps the workspace selector when neither dashboard nor fallback carries runtime binding', () => {
    expect(
      resolveDashboardBoundSelector({
        workspaceSelector: { workspaceId: 'ws-1' },
        dashboard: {},
      }),
    ).toEqual({ workspaceId: 'ws-1' });
  });
});
