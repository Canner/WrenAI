import {
  resolveRuntimeRouteSelector,
  resolveScopedNavigationSelector,
  resolveRuntimeNavigationSelector,
  resolveWorkspaceNavigationSelector,
  shouldPreserveKnowledgeRuntimeScope,
  shouldNavigateRuntimeScope,
} from './useRuntimeScopeNavigation';
import { Path } from '@/utils/enum';

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

describe('shouldPreserveKnowledgeRuntimeScope', () => {
  it('preserves the full runtime selector for knowledge-scoped destinations', () => {
    expect(shouldPreserveKnowledgeRuntimeScope(Path.Knowledge)).toBe(true);
    expect(shouldPreserveKnowledgeRuntimeScope(Path.Modeling)).toBe(true);
    expect(
      shouldPreserveKnowledgeRuntimeScope(Path.RecommendRelationships),
    ).toBe(true);
    expect(shouldPreserveKnowledgeRuntimeScope(Path.RecommendSemantics)).toBe(
      true,
    );
    expect(
      shouldPreserveKnowledgeRuntimeScope(`${Path.Knowledge}?section=modeling`),
    ).toBe(true);
  });

  it('keeps workspace-only navigation for non knowledge destinations', () => {
    expect(shouldPreserveKnowledgeRuntimeScope(Path.Home)).toBe(false);
    expect(shouldPreserveKnowledgeRuntimeScope(Path.HomeDashboard)).toBe(false);
    expect(shouldPreserveKnowledgeRuntimeScope(Path.Settings)).toBe(false);
  });
});

describe('resolveScopedNavigationSelector', () => {
  const fullSelector = {
    workspaceId: 'ws-1',
    knowledgeBaseId: 'kb-1',
    kbSnapshotId: 'snap-1',
    deployHash: 'hash-1',
  };

  it('preserves the full selector when navigating to knowledge workbench pages', () => {
    expect(
      resolveScopedNavigationSelector({
        selector: fullSelector,
        path: Path.Knowledge,
      }),
    ).toEqual(fullSelector);

    expect(
      resolveScopedNavigationSelector({
        selector: fullSelector,
        path: Path.Modeling,
      }),
    ).toEqual(fullSelector);
    expect(
      resolveScopedNavigationSelector({
        selector: fullSelector,
        path: Path.RecommendRelationships,
      }),
    ).toEqual(fullSelector);
    expect(
      resolveScopedNavigationSelector({
        selector: fullSelector,
        path: Path.RecommendSemantics,
      }),
    ).toEqual(fullSelector);
  });

  it('falls back to workspace-only selector for non knowledge pages', () => {
    expect(
      resolveScopedNavigationSelector({
        selector: fullSelector,
        path: Path.Home,
      }),
    ).toEqual({ workspaceId: 'ws-1' });
    expect(
      resolveScopedNavigationSelector({
        selector: fullSelector,
        path: Path.HomeDashboard,
      }),
    ).toEqual({ workspaceId: 'ws-1' });
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

describe('resolveRuntimeRouteSelector', () => {
  it('keeps the explicit route selector when router query is already hydrated', () => {
    expect(
      resolveRuntimeRouteSelector({
        selectorFromRoute: {
          workspaceId: 'ws-route',
          knowledgeBaseId: 'kb-route',
        },
        windowSearch: '?workspaceId=ws-window&knowledgeBaseId=kb-window',
      }),
    ).toEqual({
      workspaceId: 'ws-route',
      knowledgeBaseId: 'kb-route',
    });
  });

  it('falls back to window.location search instead of stale storage-backed selector state during router hydration', () => {
    expect(
      resolveRuntimeRouteSelector({
        selectorFromRoute: {},
        windowSearch: '?workspaceId=ws-window&knowledgeBaseId=kb-window',
      }),
    ).toEqual({
      workspaceId: 'ws-window',
      knowledgeBaseId: 'kb-window',
    });
  });
});
