import {
  resolveRuntimeNavigationSelector,
  resolveWorkspaceNavigationSelector,
  shouldNavigateRuntimeScope,
} from './useRuntimeScopeNavigation';

describe('shouldNavigateRuntimeScope', () => {
  it('skips navigation when the next url is empty or unchanged', () => {
    expect(shouldNavigateRuntimeScope('', '/home')).toBe(false);
    expect(shouldNavigateRuntimeScope(null, '/home')).toBe(false);
    expect(
      shouldNavigateRuntimeScope(
        '/home?workspaceId=ws-1',
        '/home?workspaceId=ws-1',
      ),
    ).toBe(false);
  });

  it('allows navigation when the next url differs from the current one', () => {
    expect(
      shouldNavigateRuntimeScope(
        '/workspace?workspaceId=ws-1',
        '/home?workspaceId=ws-1',
      ),
    ).toBe(true);
  });
});

describe('resolveWorkspaceNavigationSelector', () => {
  it('returns workspace-only selector when workspace id exists', () => {
    expect(
      resolveWorkspaceNavigationSelector({
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snap-1',
      }),
    ).toEqual({ workspaceId: 'ws-1' });
  });

  it('falls back to runtimeScopeId when workspace id is missing', () => {
    expect(
      resolveWorkspaceNavigationSelector({
        runtimeScopeId: 'scope-1',
        knowledgeBaseId: 'kb-1',
      }),
    ).toEqual({ runtimeScopeId: 'scope-1' });
  });

  it('returns empty selector when neither workspace nor runtime scope id exists', () => {
    expect(
      resolveWorkspaceNavigationSelector({
        knowledgeBaseId: 'kb-1',
      }),
    ).toEqual({});
  });
});

describe('resolveRuntimeNavigationSelector', () => {
  it('prefers the explicit selector from the route', () => {
    expect(
      resolveRuntimeNavigationSelector({
        selectorFromRoute: {
          workspaceId: 'ws-1',
          knowledgeBaseId: 'kb-1',
        },
        storedSelector: {
          workspaceId: 'ws-2',
        },
      }),
    ).toEqual({
      workspaceId: 'ws-1',
      knowledgeBaseId: 'kb-1',
    });
  });

  it('falls back to the stored selector when the route has no runtime scope', () => {
    expect(
      resolveRuntimeNavigationSelector({
        selectorFromRoute: {},
        storedSelector: {
          workspaceId: 'ws-2',
          runtimeScopeId: 'scope-2',
        },
      }),
    ).toEqual({
      workspaceId: 'ws-2',
      runtimeScopeId: 'scope-2',
    });
  });
});
