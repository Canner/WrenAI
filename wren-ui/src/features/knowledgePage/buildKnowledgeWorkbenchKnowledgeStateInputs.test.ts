import buildKnowledgeWorkbenchBaseMetaInputs from './buildKnowledgeWorkbenchBaseMetaInputs';
import buildKnowledgeWorkbenchBaseSelectionInputs from './buildKnowledgeWorkbenchBaseSelectionInputs';
import buildKnowledgeWorkbenchDataLoadersInputs from './buildKnowledgeWorkbenchDataLoadersInputs';
import buildKnowledgeWorkbenchListCacheInputs from './buildKnowledgeWorkbenchListCacheInputs';
import buildKnowledgeWorkbenchRuntimeBindingsInputs from './buildKnowledgeWorkbenchRuntimeBindingsInputs';
import buildKnowledgeWorkbenchRuntimeContextInputs from './buildKnowledgeWorkbenchRuntimeContextInputs';
import buildKnowledgeWorkbenchSelectorFallbackInputs from './buildKnowledgeWorkbenchSelectorFallbackInputs';

describe('buildKnowledgeWorkbenchKnowledgeStateInputs', () => {
  it('builds runtime-context inputs from router/runtime flags', () => {
    const runtimeSelectorState = {
      currentWorkspace: { id: 'ws-1' },
    } as any;

    const inputs = buildKnowledgeWorkbenchRuntimeContextInputs(
      {
        hasRuntimeScope: true,
        routerQuery: { workspaceId: 'ws-1', knowledgeBaseId: 'kb-1' },
        routerReady: true,
      } as any,
      runtimeSelectorState,
    );

    expect(inputs).toEqual({
      hasRuntimeScope: true,
      routerQuery: { workspaceId: 'ws-1', knowledgeBaseId: 'kb-1' },
      routerReady: true,
      runtimeSelectorState,
    });
  });

  it('builds knowledge-base list cache inputs from effective workspace scope', () => {
    const inputs = buildKnowledgeWorkbenchListCacheInputs(
      {
        hasRuntimeScope: true,
      } as any,
      {
        effectiveRuntimeSelector: { workspaceId: 'ws-1' },
      } as any,
    );

    expect(inputs).toEqual({
      hasRuntimeScope: true,
      workspaceId: 'ws-1',
    });
  });

  it('builds selector fallback inputs from runtime context and current workspace', () => {
    const runtimeSelectorState = {
      currentKnowledgeBase: { id: 'kb-current' },
    } as any;

    const inputs = buildKnowledgeWorkbenchSelectorFallbackInputs(
      {
        currentKbSnapshotId: 'snapshot-current',
        effectiveRuntimeSelector: { workspaceId: 'ws-1' },
        routeKbSnapshotId: 'snapshot-route',
        routeKnowledgeBaseId: 'kb-route',
      },
      {
        currentWorkspaceId: 'ws-current',
        runtimeSelectorState,
      },
    );

    expect(inputs).toEqual({
      runtimeSelectorState,
      routeKnowledgeBaseId: 'kb-route',
      effectiveWorkspaceId: 'ws-1',
      currentWorkspaceId: 'ws-current',
      routeKbSnapshotId: 'snapshot-route',
      currentKbSnapshotId: 'snapshot-current',
    });
  });

  it('builds data-loader inputs from the runtime scope URL builder', () => {
    const buildRuntimeScopeUrl = (path: string) => path;

    const inputs = buildKnowledgeWorkbenchDataLoadersInputs({
      buildRuntimeScopeUrl,
    } as any);

    expect(inputs).toEqual({
      buildRuntimeScopeUrl,
    });
  });

  it('builds knowledge-base selection inputs from route/cache/data-loader state', () => {
    const fetchKnowledgeBaseList = jest.fn(async () => []);
    const handleKnowledgeBaseLoadError = jest.fn();

    const inputs = buildKnowledgeWorkbenchBaseSelectionInputs(
      {
        hasRuntimeScope: true,
        routerAsPath: '/knowledge',
        transitionTo: jest.fn(async () => undefined),
      } as any,
      {
        currentKnowledgeBaseId: 'kb-1',
        handleKnowledgeBaseLoadError,
        knowledgeBasesUrl: '/api/v1/knowledge/bases?workspaceId=ws-1',
        cachedKnowledgeBaseList: [
          {
            id: 'kb-1',
            workspaceId: 'ws-1',
            slug: 'demo-kb',
            name: 'Demo KB',
          },
        ],
        routeKnowledgeBaseId: 'kb-1',
        fetchKnowledgeBaseList,
      },
    );

    expect(inputs).toEqual(
      expect.objectContaining({
        hasRuntimeScope: true,
        currentPath: '/knowledge',
        currentKnowledgeBaseId: 'kb-1',
        routeKnowledgeBaseId: 'kb-1',
        fetchKnowledgeBases: fetchKnowledgeBaseList,
        onLoadError: handleKnowledgeBaseLoadError,
      }),
    );
    expect(
      inputs.shouldRouteSwitchKnowledgeBase({ id: 'kb-2' } as any, 'kb-1'),
    ).toBe(true);
    expect(
      inputs.shouldRouteSwitchKnowledgeBase({ id: 'kb-1' } as any, 'kb-1'),
    ).toBe(false);
  });

  it('builds knowledge-base meta inputs with lifecycle helpers injected', () => {
    const inputs = buildKnowledgeWorkbenchBaseMetaInputs(
      {
        snapshotReadonlyHint: 'readonly',
      } as any,
      {
        authorizationActions: { 'knowledge_base.create': true },
        currentKbSnapshotId: 'snapshot-1',
        currentKnowledgeBaseId: 'kb-1',
        knowledgeBases: [{ id: 'kb-1' }],
        roleKey: 'admin',
        routeKbSnapshotId: 'snapshot-1',
        routeKnowledgeBaseId: 'kb-1',
        selectedKnowledgeBaseId: 'kb-1',
        selectorKnowledgeBaseFallback: { id: 'kb-fallback' } as any,
        workspaceKind: 'custom',
      },
    );

    expect(inputs).toEqual(
      expect.objectContaining({
        currentKnowledgeBaseId: 'kb-1',
        selectedKnowledgeBaseId: 'kb-1',
        snapshotReadonlyHint: 'readonly',
        workspaceKind: 'custom',
        roleKey: 'admin',
        selectorKnowledgeBaseFallback: { id: 'kb-fallback' },
        resolveLifecycleActionLabel: expect.any(Function),
        canShowKnowledgeLifecycleAction: expect.any(Function),
        resolveReferenceOwner: expect.any(Function),
      }),
    );
  });

  it('builds runtime-binding inputs from meta/runtime context state', () => {
    const runtimeSelectorState = {
      currentWorkspace: { id: 'ws-1' },
    } as any;
    const activeKnowledgeBase = { id: 'kb-1' } as any;

    const inputs = buildKnowledgeWorkbenchRuntimeBindingsInputs(
      {
        runtimeNavigationWorkspaceId: 'ws-1',
      } as any,
      {
        activeKnowledgeBase,
        effectiveWorkspaceId: 'ws-1',
        runtimeSelectorState,
      },
    );

    expect(inputs).toEqual({
      activeKnowledgeBase,
      effectiveWorkspaceId: 'ws-1',
      runtimeNavigationWorkspaceId: 'ws-1',
      runtimeSelectorState,
    });
  });
});
