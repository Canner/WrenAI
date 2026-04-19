import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import useKnowledgeWorkbenchNavigationState from './useKnowledgeWorkbenchNavigationState';

const mockUseKnowledgeSidebarData = jest.fn();
const mockUseKnowledgeWorkbenchSectionRouting = jest.fn();

jest.mock('@/hooks/useKnowledgeSidebarData', () => ({
  __esModule: true,
  default: (...args: any[]) => mockUseKnowledgeSidebarData(...args),
}));

jest.mock('./useKnowledgeWorkbenchSectionRouting', () => ({
  __esModule: true,
  default: (...args: any[]) => mockUseKnowledgeWorkbenchSectionRouting(...args),
}));

describe('useKnowledgeWorkbenchNavigationState', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseKnowledgeSidebarData.mockReturnValue({
      visibleKnowledgeItems: [{ id: 'kb-1', title: 'Demo KB' }],
    });
    mockUseKnowledgeWorkbenchSectionRouting.mockReturnValue({
      activeWorkbenchSection: 'overview',
      handleChangeWorkbenchSection: jest.fn(),
      buildKnowledgeSwitchUrl: jest.fn(() => '/knowledge?knowledgeBaseId=kb-1'),
      handleNavigateModeling: jest.fn(),
    });
  });

  const renderHookHarness = () => {
    let current!: ReturnType<typeof useKnowledgeWorkbenchNavigationState>;

    const Harness = () => {
      current = useKnowledgeWorkbenchNavigationState({
        activeKnowledgeBase: {
          id: 'kb-1',
          name: 'Demo KB',
          slug: 'demo-kb',
          workspaceId: 'ws-1',
        },
        buildKnowledgeRuntimeSelector: jest.fn(() => ({ workspaceId: 'ws-1' })),
        buildRuntimeScopeUrl: (path) => path,
        knowledgeBases: [],
        knowledgeTab: 'workspace',
        openAssetWizard: jest.fn(),
        replaceWorkspace: jest.fn(async () => undefined),
        routerQuery: { section: 'overview' },
        setDetailAsset: jest.fn(),
      });
      return null;
    };

    renderToStaticMarkup(React.createElement(Harness));
    return current;
  };

  it('composes sidebar data, section routing and asset-detail callbacks', () => {
    const hookValue = renderHookHarness();

    expect(hookValue.activeWorkbenchSection).toBe('overview');
    expect(hookValue.visibleKnowledgeItems).toEqual([
      { id: 'kb-1', title: 'Demo KB' },
    ]);
    expect(mockUseKnowledgeSidebarData).toHaveBeenCalled();
    expect(mockUseKnowledgeWorkbenchSectionRouting).toHaveBeenCalled();
  });
});
