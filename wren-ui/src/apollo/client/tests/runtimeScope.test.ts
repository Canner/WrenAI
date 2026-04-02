import {
  buildRuntimeScopeSelectorFromRuntimeSelectorState,
  buildRuntimeScopeStateKey,
  buildRuntimeScopeQuery,
  buildRuntimeScopeHeaders,
  buildRuntimeScopeUrl,
  hasExplicitRuntimeScopeSelector,
  omitRuntimeScopeQuery,
  readRuntimeScopeSelectorFromObject,
  readRuntimeScopeSelectorFromSearch,
  readRuntimeScopeSelectorFromUrl,
  resolveClientRuntimeScopeSelector,
  shouldBlockRuntimeScopeBootstrapRender,
} from '../runtimeScope';
import type { RuntimeScopeWindowLike } from '../runtimeScope';

const createStorage = (initial: Record<string, string> = {}) => {
  const values = new Map(Object.entries(initial));

  return {
    getItem: (key: string) => values.get(key) || null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
};

const createWindowLike = (
  search = '',
  storage = createStorage(),
): RuntimeScopeWindowLike => ({
  location: { search },
  sessionStorage: storage,
});

describe('apollo client runtime scope helpers', () => {
  it('reads runtime selector aliases from query string', () => {
    expect(
      readRuntimeScopeSelectorFromSearch(
        '?workspace_id=ws-1&knowledge_base_id=kb-1&kb_snapshot_id=snap-1&deploy_hash=deploy-1&legacy_project_id=9',
      ),
    ).toEqual({
      workspaceId: 'ws-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snap-1',
      deployHash: 'deploy-1',
      projectId: '9',
    });
  });

  it('reads runtime selector from a full URL', () => {
    expect(
      readRuntimeScopeSelectorFromUrl(
        '/home/dashboard?workspaceId=ws-2&knowledgeBaseId=kb-2&kbSnapshotId=snap-2',
      ),
    ).toEqual({
      workspaceId: 'ws-2',
      knowledgeBaseId: 'kb-2',
      kbSnapshotId: 'snap-2',
    });
  });

  it('reads runtime selector aliases from a query object', () => {
    expect(
      readRuntimeScopeSelectorFromObject({
        workspace_id: 'ws-obj',
        knowledgeBaseId: 'kb-obj',
        kb_snapshot_id: 'snap-obj',
        deployHash: 'deploy-obj',
        project_id: '11',
      }),
    ).toEqual({
      workspaceId: 'ws-obj',
      knowledgeBaseId: 'kb-obj',
      kbSnapshotId: 'snap-obj',
      deployHash: 'deploy-obj',
      projectId: '11',
    });
  });

  it('prefers explicit query selector and persists it into session storage', () => {
    const storage = createStorage({
      'wren.runtimeScope': JSON.stringify({
        workspaceId: 'ws-stale',
        knowledgeBaseId: 'kb-stale',
      }),
    });

    const selector = resolveClientRuntimeScopeSelector({
      windowObject: createWindowLike(
        '?workspaceId=ws-2&knowledgeBaseId=kb-2',
        storage,
      ),
    });

    expect(selector).toEqual({
      workspaceId: 'ws-2',
      knowledgeBaseId: 'kb-2',
    });
    expect(JSON.parse(storage.getItem('wren.runtimeScope') as string)).toEqual({
      workspaceId: 'ws-2',
      knowledgeBaseId: 'kb-2',
    });
  });

  it('falls back to stored selector when route has no explicit runtime scope', () => {
    const storage = createStorage({
      'wren.runtimeScope': JSON.stringify({
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snap-1',
        deployHash: 'deploy-1',
      }),
    });

    expect(
      resolveClientRuntimeScopeSelector({
        windowObject: createWindowLike('', storage),
      }),
    ).toEqual({
      workspaceId: 'ws-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snap-1',
      deployHash: 'deploy-1',
    });
  });

  it('builds GraphQL headers from runtime selector', () => {
    expect(
      buildRuntimeScopeHeaders({
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snap-1',
        deployHash: 'deploy-1',
        projectId: '5',
      }),
    ).toEqual({
      'x-wren-workspace-id': 'ws-1',
      'x-wren-knowledge-base-id': 'kb-1',
      'x-wren-kb-snapshot-id': 'snap-1',
      'x-wren-deploy-hash': 'deploy-1',
      'x-wren-project-id': '5',
    });
  });

  it('builds route query params and detects explicit selector', () => {
    const selector = {
      workspaceId: 'ws-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snap-1',
      deployHash: 'deploy-1',
    };

    expect(hasExplicitRuntimeScopeSelector(selector)).toBe(true);
    expect(buildRuntimeScopeQuery(selector)).toEqual({
      workspaceId: 'ws-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snap-1',
      deployHash: 'deploy-1',
    });
  });

  it('omits runtime scope params from route query objects', () => {
    expect(
      omitRuntimeScopeQuery({
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-1',
        tab: 'overview',
        page: ['2'],
      }),
    ).toEqual({
      tab: 'overview',
      page: '2',
    });
  });

  it('builds a stable runtime scope state key', () => {
    expect(
      buildRuntimeScopeStateKey({
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snap-1',
        deployHash: 'deploy-1',
        projectId: '9',
      }),
    ).toBe('ws-1|kb-1|snap-1|deploy-1|9');
  });

  it('builds a bootstrap selector from runtime selector state', () => {
    expect(
      buildRuntimeScopeSelectorFromRuntimeSelectorState({
        currentProjectId: 77,
        currentWorkspace: { id: 'ws-1' },
        currentKnowledgeBase: { id: 'kb-1' },
        currentKbSnapshot: { id: 'snap-1', deployHash: 'deploy-1' },
      }),
    ).toEqual({
      workspaceId: 'ws-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snap-1',
      deployHash: 'deploy-1',
    });

    expect(
      buildRuntimeScopeSelectorFromRuntimeSelectorState({
        currentProjectId: 88,
        currentWorkspace: null,
        currentKnowledgeBase: null,
        currentKbSnapshot: null,
      }),
    ).toEqual({
      projectId: '88',
    });
  });

  it('keeps bootstrap loading blocked until router is ready', () => {
    expect(
      shouldBlockRuntimeScopeBootstrapRender({
        hasUrlSelector: false,
        isBrowser: true,
        isServerBootstrapLoading: false,
        routerReady: false,
        selectorToSync: null,
        syncFailed: false,
      }),
    ).toBe(true);
  });

  it('does not block forever when server bootstrap settles without a selector', () => {
    expect(
      shouldBlockRuntimeScopeBootstrapRender({
        hasUrlSelector: false,
        isBrowser: true,
        isServerBootstrapLoading: false,
        routerReady: true,
        selectorToSync: null,
        syncFailed: false,
      }),
    ).toBe(false);
  });

  it('keeps render blocked while a selector still needs syncing into the url', () => {
    expect(
      shouldBlockRuntimeScopeBootstrapRender({
        hasUrlSelector: false,
        isBrowser: true,
        isServerBootstrapLoading: false,
        routerReady: true,
        selectorToSync: { projectId: '88' },
        syncFailed: false,
      }),
    ).toBe(true);
  });

  it('builds stream URLs with runtime selector query params', () => {
    expect(
      buildRuntimeScopeUrl('/api/ask_task/streaming?queryId=ask-1', {
        responseId: 7,
      }, {
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snap-1',
        deployHash: 'deploy-1',
      }),
    ).toBe(
      '/api/ask_task/streaming?queryId=ask-1&responseId=7&workspaceId=ws-1&knowledgeBaseId=kb-1&kbSnapshotId=snap-1&deployHash=deploy-1',
    );
  });
});
