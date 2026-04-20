import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import useAutoComplete, {
  buildAutoCompleteRequestKey,
} from './useAutoComplete';

const mockUseRuntimeScopeNavigation = jest.fn();
const mockUseRestRequest = jest.fn();
const mockPeekKnowledgeDiagramPayload = jest.fn();

jest.mock('./useRuntimeScopeNavigation', () => ({
  __esModule: true,
  default: () => mockUseRuntimeScopeNavigation(),
}));

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
  };
});

describe('useAutoComplete hook contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseRuntimeScopeNavigation.mockReturnValue({
      selector: {
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snap-1',
        deployHash: 'deploy-1',
      },
    });
    mockPeekKnowledgeDiagramPayload.mockReturnValue(null);
    mockUseRestRequest.mockReturnValue({
      data: null,
      loading: false,
      error: null,
      refetch: jest.fn(),
      cancel: jest.fn(),
      reset: jest.fn(),
      setData: jest.fn(),
    });
  });

  it('builds a request key only when autocomplete loading is not skipped', () => {
    expect(
      buildAutoCompleteRequestKey({
        skip: true,
        selector: { workspaceId: 'ws-1' },
      }),
    ).toBeNull();

    expect(
      buildAutoCompleteRequestKey({
        skip: false,
        selector: {
          workspaceId: 'ws-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snap-1',
          deployHash: 'deploy-1',
        },
      }),
    ).toBe(
      '/api/v1/knowledge/diagram?workspaceId=ws-1&knowledgeBaseId=kb-1&kbSnapshotId=snap-1&deployHash=deploy-1',
    );
  });

  it('passes the derived request key into useRestRequest', () => {
    const Harness = () => {
      useAutoComplete({});
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

  it('skips auto-fetch when cached diagram payload already exists', () => {
    mockPeekKnowledgeDiagramPayload.mockReturnValue({
      diagram: {
        models: [],
        views: [],
      },
    });

    const Harness = () => {
      useAutoComplete({});
      return null;
    };

    renderToStaticMarkup(React.createElement(Harness));

    expect(mockUseRestRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        auto: false,
        initialData: {
          diagram: {
            models: [],
            views: [],
          },
        },
      }),
    );
  });
});
