import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import useKnowledgeWorkbenchControllerDataState from './useKnowledgeWorkbenchControllerDataState';

const mockUseKnowledgeWorkbenchKnowledgeState = jest.fn();
const mockUseKnowledgeWorkbenchContentData = jest.fn();
const mockUseKnowledgeWorkbenchModelingState = jest.fn();

jest.mock('./useKnowledgeWorkbenchKnowledgeState', () => ({
  __esModule: true,
  default: (...args: any[]) => mockUseKnowledgeWorkbenchKnowledgeState(...args),
}));

jest.mock('./useKnowledgeWorkbenchContentData', () => ({
  __esModule: true,
  default: (...args: any[]) => mockUseKnowledgeWorkbenchContentData(...args),
}));

jest.mock('./useKnowledgeWorkbenchModelingState', () => ({
  __esModule: true,
  default: (...args: any[]) => mockUseKnowledgeWorkbenchModelingState(...args),
}));

describe('useKnowledgeWorkbenchControllerDataState', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseKnowledgeWorkbenchKnowledgeState.mockReturnValue({
      activeKnowledgeBase: {
        id: 'kb-1',
        name: 'Demo KB',
        slug: 'demo-kb',
        workspaceId: 'ws-1',
      },
      activeKnowledgeBaseExecutable: true,
      activeKnowledgeRuntimeSelector: { workspaceId: 'ws-1' },
      activeKnowledgeSnapshotId: 'snap-1',
      fetchConnectors: jest.fn(),
      handleConnectorLoadError: jest.fn(),
      initialKnowledgeSourceType: 'database',
      knowledgeOwner: 'owner',
      knowledgeSourceOptions: [],
      matchedDemoKnowledge: null,
      refetchRuntimeSelector: jest.fn(async () => undefined),
      runtimeSyncScopeKey: 'ws-1|kb-1',
      runtimeSelectorState: { currentKbSnapshot: { deployHash: 'deploy-1' } },
    });
    mockUseKnowledgeWorkbenchContentData.mockReturnValue({
      diagramData: { diagram: {} },
      routeRuntimeSyncing: false,
    });
    mockUseKnowledgeWorkbenchModelingState.mockReturnValue({
      committedModelingWorkspaceKey: 'kb-1:snap-1:deploy-1',
      modelingSummary: { modelCount: 1, relationCount: 0, viewCount: 0 },
    });
  });

  const renderHookHarness = () => {
    let current!: ReturnType<typeof useKnowledgeWorkbenchControllerDataState>;

    const Harness = () => {
      current = useKnowledgeWorkbenchControllerDataState({
        assetModalOpen: false,
        buildRuntimeScopeUrl: (path) => path,
        draftAssets: [],
        hasRuntimeScope: true,
        routerAsPath: '/knowledge',
        routerQuery: { knowledgeBaseId: 'kb-1' },
        routerReady: true,
        runtimeNavigationWorkspaceId: 'ws-1',
        runtimeTransitioning: false,
        transitionTo: jest.fn(async () => undefined),
      });
      return null;
    };

    renderToStaticMarkup(React.createElement(Harness));
    return current;
  };

  it('composes knowledge state, content data and modeling state', () => {
    const hookValue = renderHookHarness();

    expect(mockUseKnowledgeWorkbenchKnowledgeState).toHaveBeenCalled();
    expect(mockUseKnowledgeWorkbenchContentData).toHaveBeenCalledWith(
      expect.objectContaining({
        activeKnowledgeBaseExecutable: true,
        runtimeTransitioning: false,
      }),
    );
    expect(mockUseKnowledgeWorkbenchModelingState).toHaveBeenCalledWith({
      activeKnowledgeBaseId: 'kb-1',
      activeKnowledgeSnapshotId: 'snap-1',
      deployHash: 'deploy-1',
      diagramData: { diagram: {} },
      routeRuntimeSyncing: false,
    });
    expect(hookValue.modelingState.committedModelingWorkspaceKey).toBe(
      'kb-1:snap-1:deploy-1',
    );
  });
});
