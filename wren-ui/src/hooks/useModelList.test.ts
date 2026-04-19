import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import useModelList, {
  buildModelListRequestKey,
  buildModelListUrl,
  normalizeModelListPayload,
} from './useModelList';

const mockUseRuntimeScopeNavigation = jest.fn();
const mockUseRestRequest = jest.fn();

jest.mock('@/hooks/useRuntimeScopeNavigation', () => ({
  __esModule: true,
  default: () => mockUseRuntimeScopeNavigation(),
}));

jest.mock('./useRestRequest', () => ({
  __esModule: true,
  default: (...args: any[]) => mockUseRestRequest(...args),
}));

describe('useModelList', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseRuntimeScopeNavigation.mockReturnValue({
      selector: {
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snap-1',
        deployHash: 'deploy-1',
      },
    });
    mockUseRestRequest.mockReturnValue({
      data: [],
      loading: false,
    });
  });

  it('builds the model-list URL and request key from an executable runtime scope', () => {
    const selector = {
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snap-1',
      deployHash: 'deploy-1',
    };

    expect(buildModelListUrl(selector)).toBe(
      '/api/v1/models/list?workspaceId=workspace-1&knowledgeBaseId=kb-1&kbSnapshotId=snap-1&deployHash=deploy-1',
    );
    expect(
      buildModelListRequestKey({
        enabled: true,
        selector,
      }),
    ).toBe(
      '/api/v1/models/list?workspaceId=workspace-1&knowledgeBaseId=kb-1&kbSnapshotId=snap-1&deployHash=deploy-1',
    );
    expect(
      buildModelListRequestKey({
        enabled: false,
        selector,
      }),
    ).toBeNull();
    expect(
      buildModelListRequestKey({
        enabled: true,
        selector: { workspaceId: 'workspace-1' },
      }),
    ).toBeNull();
  });

  it('normalizes invalid payloads to an empty model list', () => {
    expect(normalizeModelListPayload(null)).toEqual([]);
    expect(normalizeModelListPayload({ items: [] })).toEqual([]);
  });

  it('passes the derived request key into useRestRequest', () => {
    const Harness = () => {
      useModelList({ enabled: true });
      return null;
    };

    renderToStaticMarkup(React.createElement(Harness));

    expect(mockUseRestRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        auto: true,
        initialData: null,
        requestKey:
          '/api/v1/models/list?workspaceId=workspace-1&knowledgeBaseId=kb-1&kbSnapshotId=snap-1&deployHash=deploy-1',
      }),
    );
  });
});
