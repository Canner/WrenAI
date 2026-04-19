import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import useKnowledgeWorkbenchModelingState from './useKnowledgeWorkbenchModelingState';

const mockUseKnowledgeModelingWorkspaceKey = jest.fn();
const mockBuildKnowledgeModelingSummary = jest.fn();

jest.mock('./useKnowledgeModelingWorkspaceKey', () => ({
  __esModule: true,
  default: (...args: any[]) => mockUseKnowledgeModelingWorkspaceKey(...args),
}));

jest.mock('./sections/buildKnowledgeModelingSummary', () => ({
  __esModule: true,
  buildKnowledgeModelingSummary: (...args: any[]) =>
    mockBuildKnowledgeModelingSummary(...args),
}));

describe('useKnowledgeWorkbenchModelingState', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseKnowledgeModelingWorkspaceKey.mockReturnValue(
      'kb-1:snap-1:deploy-1',
    );
    mockBuildKnowledgeModelingSummary.mockReturnValue({
      modelCount: 3,
      relationCount: 2,
      viewCount: 1,
    });
  });

  const renderHookHarness = () => {
    let current!: ReturnType<typeof useKnowledgeWorkbenchModelingState>;

    const Harness = () => {
      current = useKnowledgeWorkbenchModelingState({
        activeKnowledgeBaseId: 'kb-1',
        activeKnowledgeSnapshotId: 'snap-1',
        deployHash: 'deploy-1',
        diagramData: {
          diagram: {
            models: [{ relationFields: [] }],
            views: [{}],
          },
        },
        routeRuntimeSyncing: false,
      });
      return null;
    };

    renderToStaticMarkup(React.createElement(Harness));
    return current;
  };

  it('composes modeling summary and committed workspace key', () => {
    const hookValue = renderHookHarness();

    expect(hookValue).toEqual({
      committedModelingWorkspaceKey: 'kb-1:snap-1:deploy-1',
      modelingSummary: {
        modelCount: 3,
        relationCount: 2,
        viewCount: 1,
      },
    });
    expect(mockBuildKnowledgeModelingSummary).toHaveBeenCalledWith({
      models: [{ relationFields: [] }],
      views: [{}],
    });
    expect(mockUseKnowledgeModelingWorkspaceKey).toHaveBeenCalledWith({
      activeKnowledgeBaseId: 'kb-1',
      activeKnowledgeSnapshotId: 'snap-1',
      deployHash: 'deploy-1',
      routeRuntimeSyncing: false,
    });
  });
});
