import {
  buildRuntimeScopeBootstrapCandidates,
  buildRuntimeScopeSelectorFromRuntimeSelectorState,
  buildRuntimeScopeStateKey,
  buildRuntimeScopeQuery,
  buildRuntimeScopeHeaders,
  buildRuntimeScopeUrl,
  hasExplicitRuntimeScopeSelector,
  hasExecutableRuntimeScopeSelector,
  mergeRuntimeScopeSelectors,
  mergeRuntimeScopeRequestHeaders,
  omitRuntimeScopeQuery,
  readPersistedRuntimeScopeSelector,
  readRuntimeScopeSelectorFromObject,
  readRuntimeScopeSelectorFromSearch,
  readRuntimeScopeSelectorFromUrl,
  RUNTIME_SCOPE_RECOVERY_EVENT,
  resolveClientRuntimeScopeSelector,
  resolveHydratedRuntimeScopeSelector,
  resolveRuntimeScopeBootstrapSelector,
  shouldSkipRuntimeScopeUrlExpansion,
  shouldAcceptRuntimeScopeBootstrapCandidate,
  shouldRecoverRuntimeScopeFromErrorCode,
  shouldHydrateRuntimeScopeSelector,
  shouldBlockRuntimeScopeBootstrapRender,
  shouldDeferRuntimeScopeUrlSync,
  triggerRuntimeScopeRecovery,
  writePersistedRuntimeScopeSelector,
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

describe('client runtime scope helpers', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

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
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('deprecated compatibility query alias'),
    );
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
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('deprecated compatibility query alias'),
    );
  });

  it('ignores legacy project query aliases when no canonical runtime scope id is present', () => {
    const storage = createStorage();

    const selector = resolveClientRuntimeScopeSelector({
      windowObject: createWindowLike('?projectId=42', storage),
    });

    expect(selector).toEqual({});
    expect(storage.getItem('wren.runtimeScope')).toBeNull();
    expect(hasExplicitRuntimeScopeSelector(selector)).toBe(false);
    expect(buildRuntimeScopeHeaders(selector)).toEqual({});
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('deprecated compatibility query alias'),
    );
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

  it('reuses cached resolved selector when location and storage are unchanged', () => {
    const storage = createStorage({
      'wren.runtimeScope': JSON.stringify({
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-1',
      }),
    });
    const getItemSpy = jest.spyOn(storage, 'getItem');
    const windowObject = createWindowLike('', storage);

    expect(
      resolveClientRuntimeScopeSelector({
        windowObject,
      }),
    ).toEqual({
      workspaceId: 'ws-1',
      knowledgeBaseId: 'kb-1',
    });
    getItemSpy.mockClear();
    expect(
      resolveClientRuntimeScopeSelector({
        windowObject,
      }),
    ).toEqual({
      workspaceId: 'ws-1',
      knowledgeBaseId: 'kb-1',
    });

    expect(getItemSpy).not.toHaveBeenCalled();
  });

  it('reads and writes persisted runtime scope selectors without routing through query params', () => {
    const storage = createStorage();
    const windowObject = createWindowLike('', storage);

    writePersistedRuntimeScopeSelector(
      {
        workspaceId: 'ws-3',
        knowledgeBaseId: 'kb-3',
        kbSnapshotId: 'snap-3',
        deployHash: 'deploy-3',
      },
      { windowObject },
    );

    expect(
      readPersistedRuntimeScopeSelector({
        windowObject,
      }),
    ).toEqual({
      workspaceId: 'ws-3',
      knowledgeBaseId: 'kb-3',
      kbSnapshotId: 'snap-3',
      deployHash: 'deploy-3',
    });

    writePersistedRuntimeScopeSelector({}, { windowObject });

    expect(
      readPersistedRuntimeScopeSelector({
        windowObject,
      }),
    ).toEqual({});
  });

  it('recognizes stale runtime scope compatibility error codes', () => {
    expect(shouldRecoverRuntimeScopeFromErrorCode('NO_DEPLOYMENT_FOUND')).toBe(
      true,
    );
    expect(
      shouldRecoverRuntimeScopeFromErrorCode('OUTDATED_RUNTIME_SNAPSHOT'),
    ).toBe(true);
    expect(
      shouldRecoverRuntimeScopeFromErrorCode('INTERNAL_SERVER_ERROR'),
    ).toBe(false);
  });

  it('clears persisted runtime scope and dispatches a recovery event', () => {
    const storage = createStorage({
      'wren.runtimeScope': JSON.stringify({
        workspaceId: 'ws-stale',
        knowledgeBaseId: 'kb-stale',
      }),
    });
    const dispatchEvent = jest.fn(() => true);
    const windowObject: RuntimeScopeWindowLike = {
      location: { search: '' },
      sessionStorage: storage,
      dispatchEvent,
    };

    expect(
      triggerRuntimeScopeRecovery({
        windowObject,
      }),
    ).toBe(true);
    expect(storage.getItem('wren.runtimeScope')).toBeNull();
    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: RUNTIME_SCOPE_RECOVERY_EVENT,
      }),
    );
  });

  it('builds API headers from runtime selector', () => {
    expect(
      buildRuntimeScopeHeaders({
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snap-1',
        deployHash: 'deploy-1',
      }),
    ).toEqual({
      'x-wren-workspace-id': 'ws-1',
      'x-wren-knowledge-base-id': 'kb-1',
      'x-wren-kb-snapshot-id': 'snap-1',
      'x-wren-deploy-hash': 'deploy-1',
    });
  });

  it('lets request-scoped runtime headers override the default selector headers', () => {
    expect(
      mergeRuntimeScopeRequestHeaders(
        {
          'x-wren-workspace-id': 'ws-override',
          'x-wren-knowledge-base-id': 'kb-override',
        },
        {
          workspaceId: 'ws-default',
          knowledgeBaseId: 'kb-default',
          kbSnapshotId: 'snap-default',
          deployHash: 'deploy-default',
        },
      ),
    ).toEqual({
      'x-wren-workspace-id': 'ws-override',
      'x-wren-knowledge-base-id': 'kb-override',
      'x-wren-kb-snapshot-id': 'snap-default',
      'x-wren-deploy-hash': 'deploy-default',
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

  it('emits runtimeScopeId instead of projectId for legacy-only selectors', () => {
    const selector = {
      runtimeScopeId: '42',
    };

    expect(buildRuntimeScopeQuery(selector)).toEqual({
      runtimeScopeId: '42',
    });
    expect(buildRuntimeScopeHeaders(selector)).toEqual({
      'x-wren-runtime-scope-id': '42',
    });
    expect(buildRuntimeScopeUrl('/home', {}, selector)).toBe(
      '/home?runtimeScopeId=42',
    );
  });

  it('drops legacy project fallback once canonical runtime selectors are present', () => {
    const selector = {
      workspaceId: 'ws-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snap-1',
      deployHash: 'deploy-1',
      runtimeScopeId: '42',
    };

    expect(buildRuntimeScopeQuery(selector)).toEqual({
      workspaceId: 'ws-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snap-1',
      deployHash: 'deploy-1',
    });
    expect(buildRuntimeScopeHeaders(selector)).toEqual({
      'x-wren-workspace-id': 'ws-1',
      'x-wren-knowledge-base-id': 'kb-1',
      'x-wren-kb-snapshot-id': 'snap-1',
      'x-wren-deploy-hash': 'deploy-1',
    });
  });

  it('omits runtime scope params from route query objects', () => {
    expect(
      omitRuntimeScopeQuery({
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-1',
        legacy_project_id: '11',
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
      }),
    ).toBe('ws-1|kb-1|snap-1|deploy-1');
  });

  it('builds a bootstrap selector from runtime selector state', () => {
    expect(
      buildRuntimeScopeSelectorFromRuntimeSelectorState({
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
        currentWorkspace: null,
        currentKnowledgeBase: null,
        currentKbSnapshot: null,
      }),
    ).toEqual({});

    expect(
      buildRuntimeScopeSelectorFromRuntimeSelectorState({
        currentWorkspace: { id: 'ws-only' },
        currentKnowledgeBase: null,
        currentKbSnapshot: null,
      }),
    ).toEqual({
      workspaceId: 'ws-only',
    });

    expect(
      buildRuntimeScopeSelectorFromRuntimeSelectorState({
        currentWorkspace: { id: 'ws-partial' },
        currentKnowledgeBase: { id: 'kb-partial' },
        currentKbSnapshot: null,
      }),
    ).toEqual({
      workspaceId: 'ws-partial',
      knowledgeBaseId: 'kb-partial',
    });
  });

  it('detects when a runtime selector is executable or still needs hydration', () => {
    expect(
      hasExecutableRuntimeScopeSelector({
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-1',
      }),
    ).toBe(false);
    expect(
      shouldHydrateRuntimeScopeSelector({
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-1',
      }),
    ).toBe(true);

    expect(
      hasExecutableRuntimeScopeSelector({
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snap-1',
      }),
    ).toBe(true);
    expect(
      shouldHydrateRuntimeScopeSelector({
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snap-1',
      }),
    ).toBe(false);
  });

  it('merges partial selectors with server bootstrap data', () => {
    expect(
      mergeRuntimeScopeSelectors(
        {
          workspaceId: 'ws-1',
          knowledgeBaseId: 'kb-1',
        },
        {
          workspaceId: 'ws-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snap-1',
          deployHash: 'deploy-1',
        },
      ),
    ).toEqual({
      workspaceId: 'ws-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snap-1',
      deployHash: 'deploy-1',
    });
  });

  it('hydrates a workspace selector with the current runtime selector state', () => {
    expect(
      resolveHydratedRuntimeScopeSelector({
        selector: {
          workspaceId: 'ws-1',
        },
        selectorState: {
          currentWorkspace: { id: 'ws-1' },
          currentKnowledgeBase: { id: 'kb-1' },
          currentKbSnapshot: { id: 'snap-1', deployHash: 'deploy-1' },
        },
      }),
    ).toEqual({
      workspaceId: 'ws-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snap-1',
      deployHash: 'deploy-1',
    });
  });

  it('keeps the current selector when the hydrated runtime state crosses workspaces', () => {
    expect(
      resolveHydratedRuntimeScopeSelector({
        selector: {
          workspaceId: 'ws-1',
          knowledgeBaseId: 'kb-1',
        },
        selectorState: {
          currentWorkspace: { id: 'ws-2' },
          currentKnowledgeBase: { id: 'kb-2' },
          currentKbSnapshot: { id: 'snap-2', deployHash: 'deploy-2' },
        },
      }),
    ).toEqual({
      workspaceId: 'ws-1',
      knowledgeBaseId: 'kb-1',
    });
  });

  it('keeps the home url workspace-scoped when bootstrap only adds runtime details', () => {
    expect(
      shouldSkipRuntimeScopeUrlExpansion({
        pathname: '/home',
        selectorFromUrl: {
          workspaceId: 'ws-1',
        },
        selectorToSync: {
          workspaceId: 'ws-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snap-1',
          deployHash: 'deploy-1',
        },
      }),
    ).toBe(true);

    expect(
      shouldSkipRuntimeScopeUrlExpansion({
        pathname: '/home/dashboard',
        selectorFromUrl: {
          workspaceId: 'ws-1',
        },
        selectorToSync: {
          workspaceId: 'ws-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snap-1',
          deployHash: 'deploy-1',
        },
      }),
    ).toBe(true);

    expect(
      shouldSkipRuntimeScopeUrlExpansion({
        pathname: '/home/42',
        selectorFromUrl: {
          workspaceId: 'ws-1',
        },
        selectorToSync: {
          workspaceId: 'ws-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snap-1',
          deployHash: 'deploy-1',
        },
      }),
    ).toBe(false);
  });

  it('builds bootstrap validation candidates in url -> stored -> default order', () => {
    expect(
      buildRuntimeScopeBootstrapCandidates({
        urlSelector: {
          workspaceId: 'ws-url',
          knowledgeBaseId: 'kb-url',
        },
        storedSelector: {
          workspaceId: 'ws-stored',
          knowledgeBaseId: 'kb-stored',
          kbSnapshotId: 'snap-stored',
          deployHash: 'deploy-stored',
        },
        serverDefaultSelector: {
          workspaceId: 'ws-server',
        },
      }),
    ).toEqual([
      {
        source: 'url',
        selector: {
          workspaceId: 'ws-url',
          knowledgeBaseId: 'kb-url',
        },
      },
      {
        source: 'stored',
        selector: {
          workspaceId: 'ws-stored',
          knowledgeBaseId: 'kb-stored',
          kbSnapshotId: 'snap-stored',
          deployHash: 'deploy-stored',
        },
      },
      {
        source: 'server_default',
        selector: {
          workspaceId: 'ws-server',
        },
      },
      {
        source: 'default',
        selector: {},
      },
    ]);
  });

  it('deduplicates bootstrap candidates when url and stored selectors are identical', () => {
    expect(
      buildRuntimeScopeBootstrapCandidates({
        urlSelector: {
          workspaceId: 'ws-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snap-1',
          deployHash: 'deploy-1',
        },
        storedSelector: {
          workspaceId: 'ws-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snap-1',
          deployHash: 'deploy-1',
        },
        serverDefaultSelector: {
          workspaceId: 'ws-server',
        },
      }),
    ).toEqual([
      {
        source: 'url',
        selector: {
          workspaceId: 'ws-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snap-1',
          deployHash: 'deploy-1',
        },
      },
      {
        source: 'server_default',
        selector: {
          workspaceId: 'ws-server',
        },
      },
      {
        source: 'default',
        selector: {},
      },
    ]);
  });

  it('resolves a validated bootstrap selector by merging the candidate with server state', () => {
    expect(
      resolveRuntimeScopeBootstrapSelector({
        candidate: {
          source: 'url',
          selector: {
            workspaceId: 'ws-1',
            knowledgeBaseId: 'kb-1',
          },
        },
        selectorFromServer: {
          workspaceId: 'ws-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snap-1',
          deployHash: 'deploy-1',
        },
      }),
    ).toEqual({
      workspaceId: 'ws-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snap-1',
      deployHash: 'deploy-1',
    });

    expect(
      resolveRuntimeScopeBootstrapSelector({
        candidate: {
          source: 'default',
          selector: {},
        },
        selectorFromServer: {
          workspaceId: 'ws-default',
          knowledgeBaseId: 'kb-default',
        },
      }),
    ).toEqual({
      workspaceId: 'ws-default',
      knowledgeBaseId: 'kb-default',
    });

    expect(
      resolveRuntimeScopeBootstrapSelector({
        candidate: {
          source: 'url',
          selector: {
            workspaceId: 'ws-1',
            knowledgeBaseId: 'kb-1',
            kbSnapshotId: 'stale-snap',
            deployHash: 'stale-deploy',
          },
        },
        selectorFromServer: {
          workspaceId: 'ws-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'fresh-snap',
          deployHash: 'fresh-deploy',
        },
      }),
    ).toEqual({
      workspaceId: 'ws-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'fresh-snap',
      deployHash: 'fresh-deploy',
    });
  });

  it('rejects explicit bootstrap candidates when the server returns no runtime scope', () => {
    expect(
      shouldAcceptRuntimeScopeBootstrapCandidate({
        candidate: {
          source: 'url',
          selector: {
            workspaceId: 'ws-stale',
            knowledgeBaseId: 'kb-stale',
          },
        },
        selectorFromServer: {},
      }),
    ).toBe(false);

    expect(
      shouldAcceptRuntimeScopeBootstrapCandidate({
        candidate: {
          source: 'default',
          selector: {},
        },
        selectorFromServer: {},
      }),
    ).toBe(true);

    expect(
      shouldAcceptRuntimeScopeBootstrapCandidate({
        candidate: {
          source: 'stored',
          selector: {
            workspaceId: 'ws-1',
          },
        },
        selectorFromServer: {
          workspaceId: 'ws-1',
        },
      }),
    ).toBe(true);
  });

  it('keeps bootstrap loading blocked until router is ready', () => {
    expect(
      shouldBlockRuntimeScopeBootstrapRender({
        isBrowser: true,
        currentUrl: '/home',
        nextUrl: null,
        isBootstrapLoading: false,
        routerReady: false,
        syncFailed: false,
      }),
    ).toBe(true);
  });

  it('does not block server render because the client may already have a runtime selector in the url', () => {
    expect(
      shouldBlockRuntimeScopeBootstrapRender({
        isBrowser: false,
        currentUrl: '/home',
        nextUrl: null,
        isBootstrapLoading: false,
        routerReady: false,
        syncFailed: false,
      }),
    ).toBe(false);
  });

  it('does not block forever when server bootstrap settles without a selector', () => {
    expect(
      shouldBlockRuntimeScopeBootstrapRender({
        isBrowser: true,
        currentUrl: '/home',
        nextUrl: null,
        isBootstrapLoading: false,
        routerReady: true,
        syncFailed: false,
      }),
    ).toBe(false);
  });

  it('keeps render blocked while bootstrap validation is still running', () => {
    expect(
      shouldBlockRuntimeScopeBootstrapRender({
        isBrowser: true,
        currentUrl: '/home',
        nextUrl: null,
        isBootstrapLoading: true,
        routerReady: true,
        syncFailed: false,
      }),
    ).toBe(true);
  });

  it('keeps rendering during in-app explicit scope revalidation after the first bootstrap', () => {
    expect(
      shouldBlockRuntimeScopeBootstrapRender({
        isBrowser: true,
        currentUrl:
          '/knowledge?workspaceId=ws-1&knowledgeBaseId=kb-1&kbSnapshotId=snap-1&deployHash=deploy-1',
        nextUrl: null,
        isBootstrapLoading: true,
        routerReady: true,
        syncFailed: false,
        allowLoadingWhileValidating: true,
      }),
    ).toBe(false);
  });

  it('keeps render blocked while a validated selector still needs syncing into the url', () => {
    expect(
      shouldBlockRuntimeScopeBootstrapRender({
        isBrowser: true,
        currentUrl: '/home',
        nextUrl:
          '/home?workspaceId=ws-1&knowledgeBaseId=kb-1&kbSnapshotId=snap-1&deployHash=deploy-1',
        isBootstrapLoading: false,
        routerReady: true,
        syncFailed: false,
      }),
    ).toBe(true);
  });

  it('defers url sync while an explicit runtime scope route is still validating', () => {
    expect(
      shouldDeferRuntimeScopeUrlSync({
        isBootstrapLoading: true,
        selectorFromUrl: {
          workspaceId: 'ws-2',
          knowledgeBaseId: 'kb-2',
        },
        selectorToSync: {
          workspaceId: 'ws-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snap-1',
          deployHash: 'deploy-1',
        },
      }),
    ).toBe(true);

    expect(
      shouldDeferRuntimeScopeUrlSync({
        isBootstrapLoading: true,
        selectorFromUrl: {
          workspaceId: 'ws-2',
          knowledgeBaseId: 'kb-2',
        },
        selectorToSync: {
          workspaceId: 'ws-2',
          knowledgeBaseId: 'kb-2',
          kbSnapshotId: 'snap-2',
          deployHash: 'deploy-2',
        },
      }),
    ).toBe(false);

    expect(
      shouldDeferRuntimeScopeUrlSync({
        isBootstrapLoading: true,
        selectorFromUrl: {
          workspaceId: 'ws-2',
          knowledgeBaseId: 'kb-2',
          kbSnapshotId: 'snap-2',
          deployHash: 'deploy-2',
        },
        selectorToSync: {
          workspaceId: 'ws-2',
          knowledgeBaseId: 'kb-2',
          kbSnapshotId: 'snap-2',
          deployHash: 'deploy-2',
        },
      }),
    ).toBe(false);

    expect(
      shouldDeferRuntimeScopeUrlSync({
        isBootstrapLoading: true,
        selectorFromUrl: {},
        selectorToSync: {
          workspaceId: 'ws-1',
        },
      }),
    ).toBe(false);

    expect(
      shouldDeferRuntimeScopeUrlSync({
        isBootstrapLoading: false,
        selectorFromUrl: {
          workspaceId: 'ws-2',
          knowledgeBaseId: 'kb-2',
        },
        selectorToSync: {
          workspaceId: 'ws-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snap-1',
          deployHash: 'deploy-1',
        },
      }),
    ).toBe(true);

    expect(
      shouldDeferRuntimeScopeUrlSync({
        isBootstrapLoading: false,
        selectorFromUrl: {
          workspaceId: 'ws-2',
        },
        selectorToSync: {
          workspaceId: 'ws-2',
          knowledgeBaseId: 'kb-2',
          kbSnapshotId: 'snap-2',
          deployHash: 'deploy-2',
        },
      }),
    ).toBe(false);
  });

  it('builds stream URLs with runtime selector query params', () => {
    expect(
      buildRuntimeScopeUrl(
        '/api/ask_task/streaming?queryId=ask-1',
        {
          responseId: 7,
        },
        {
          workspaceId: 'ws-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snap-1',
          deployHash: 'deploy-1',
        },
      ),
    ).toBe(
      '/api/ask_task/streaming?queryId=ask-1&responseId=7&workspaceId=ws-1&knowledgeBaseId=kb-1&kbSnapshotId=snap-1&deployHash=deploy-1',
    );
  });

  it('drops stale legacy and snake-case runtime scope params when rebuilding urls', () => {
    expect(
      buildRuntimeScopeUrl(
        '/api/ask_task/streaming?projectId=11&workspace_id=old-ws&queryId=ask-1',
        { responseId: 7 },
        {
          workspaceId: 'ws-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snap-1',
          deployHash: 'deploy-1',
          runtimeScopeId: '42',
        },
      ),
    ).toBe(
      '/api/ask_task/streaming?queryId=ask-1&responseId=7&workspaceId=ws-1&knowledgeBaseId=kb-1&kbSnapshotId=snap-1&deployHash=deploy-1',
    );
  });

  it('keeps a canonical legacy project param when no modern selector exists', () => {
    expect(
      buildRuntimeScopeUrl(
        '/api/ask_task/streaming?legacy_project_id=11&queryId=ask-1',
        { responseId: 7 },
        { runtimeScopeId: '42' },
      ),
    ).toBe(
      '/api/ask_task/streaming?queryId=ask-1&responseId=7&runtimeScopeId=42',
    );
  });
});
