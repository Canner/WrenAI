import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import useKnowledgeDiagramData from './useKnowledgeDiagramData';

const mockUseRestRequest = jest.fn();
const mockPeekKnowledgeDiagramPayload = jest.fn();
const mockLoadKnowledgeDiagramPayload = jest.fn();

jest.mock('./useRestRequest', () => ({
  __esModule: true,
  default: (...args: any[]) => mockUseRestRequest(...args),
}));

jest.mock('@/utils/knowledgeDiagramRest', () => {
  const actual = jest.requireActual('@/utils/knowledgeDiagramRest');
  return {
    __esModule: true,
    ...actual,
    peekKnowledgeDiagramPayload: (...args: any[]) =>
      mockPeekKnowledgeDiagramPayload(...args),
    loadKnowledgeDiagramPayload: (...args: any[]) =>
      mockLoadKnowledgeDiagramPayload(...args),
  };
});

describe('useKnowledgeDiagramData hook contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPeekKnowledgeDiagramPayload.mockReturnValue(null);
    mockLoadKnowledgeDiagramPayload.mockResolvedValue({
      diagram: { models: [] },
    });
    mockUseRestRequest.mockReturnValue({
      data: null,
      loading: false,
      error: null,
      cancel: jest.fn(),
      reset: jest.fn(),
      setData: jest.fn(),
    });
  });

  it('passes the derived request key into useRestRequest when scope is executable', () => {
    const Harness = () => {
      useKnowledgeDiagramData({
        hasRuntimeScope: true,
        routeKnowledgeBaseId: 'kb-1',
        routeKbSnapshotId: 'snap-1',
        effectiveRuntimeSelector: {
          workspaceId: 'ws-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snap-1',
          deployHash: 'deploy-1',
        },
      });
      return null;
    };

    renderToStaticMarkup(React.createElement(Harness));

    expect(mockUseRestRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        auto: true,
        initialData: null,
        requestKey:
          '/api/v1/knowledge/diagram?workspaceId=ws-1&knowledgeBaseId=kb-1&kbSnapshotId=snap-1&deployHash=deploy-1',
      }),
    );
  });

  it('skips auto-fetch when cached diagram data already exists', () => {
    mockPeekKnowledgeDiagramPayload.mockReturnValue({
      diagram: { nodes: [], edges: [] },
    });

    const Harness = () => {
      useKnowledgeDiagramData({
        hasRuntimeScope: true,
        routeKnowledgeBaseId: 'kb-1',
        routeKbSnapshotId: 'snap-1',
        effectiveRuntimeSelector: {
          workspaceId: 'ws-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snap-1',
          deployHash: 'deploy-1',
        },
      });
      return null;
    };

    renderToStaticMarkup(React.createElement(Harness));

    expect(mockUseRestRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        auto: false,
        initialData: {
          diagram: { nodes: [], edges: [] },
        },
      }),
    );
  });

  it('refetches diagram without cache after asset persistence updates the model graph', async () => {
    const setData = jest.fn();
    mockUseRestRequest.mockReturnValue({
      data: null,
      loading: false,
      error: null,
      cancel: jest.fn(),
      reset: jest.fn(),
      setData,
    });

    let hookValue!: ReturnType<typeof useKnowledgeDiagramData>;
    const Harness = () => {
      hookValue = useKnowledgeDiagramData({
        hasRuntimeScope: true,
        routeKnowledgeBaseId: 'kb-1',
        routeKbSnapshotId: 'snap-1',
        effectiveRuntimeSelector: {
          workspaceId: 'ws-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snap-1',
          deployHash: 'deploy-1',
        },
      });
      return null;
    };

    renderToStaticMarkup(React.createElement(Harness));
    await hookValue.refetchDiagram();

    expect(mockLoadKnowledgeDiagramPayload).toHaveBeenCalledWith({
      requestUrl:
        '/api/v1/knowledge/diagram?workspaceId=ws-1&knowledgeBaseId=kb-1&kbSnapshotId=snap-1&deployHash=deploy-1',
      useCache: false,
    });
    expect(setData).toHaveBeenCalledWith({ diagram: { models: [] } });
  });

  it('disables requests when runtime selector is incomplete', () => {
    const Harness = () => {
      useKnowledgeDiagramData({
        hasRuntimeScope: false,
        routeKnowledgeBaseId: 'kb-1',
        routeKbSnapshotId: 'snap-1',
        effectiveRuntimeSelector: {
          workspaceId: 'ws-1',
        },
      });
      return null;
    };

    renderToStaticMarkup(React.createElement(Harness));

    expect(mockUseRestRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: false,
        auto: false,
        initialData: null,
        requestKey: null,
      }),
    );
  });
});
