import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  buildDashboardDetailRequestKey,
  buildDashboardListRequestKey,
  useDashboardDetailData,
  useDashboardListData,
} from './useManageDashboardData';

const mockUseRestRequest = jest.fn();
const mockPeekDashboardListPayload = jest.fn();
const mockPeekDashboardDetailPayload = jest.fn();
const mockLoadDashboardListPayload = jest.fn();
const mockLoadDashboardDetailPayload = jest.fn();
const mockPrimeDashboardDetailPayload = jest.fn();

jest.mock('@/hooks/useRestRequest', () => ({
  __esModule: true,
  default: (...args: any[]) => mockUseRestRequest(...args),
}));

jest.mock('@/utils/dashboardRest', () => {
  const actual = jest.requireActual('@/utils/dashboardRest');
  return {
    __esModule: true,
    ...actual,
    peekDashboardListPayload: (...args: any[]) =>
      mockPeekDashboardListPayload(...args),
    peekDashboardDetailPayload: (...args: any[]) =>
      mockPeekDashboardDetailPayload(...args),
    loadDashboardListPayload: (...args: any[]) =>
      mockLoadDashboardListPayload(...args),
    loadDashboardDetailPayload: (...args: any[]) =>
      mockLoadDashboardDetailPayload(...args),
    primeDashboardDetailPayload: (...args: any[]) =>
      mockPrimeDashboardDetailPayload(...args),
  };
});

describe('useManageDashboardData hook contracts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPeekDashboardListPayload.mockReturnValue([]);
    mockPeekDashboardDetailPayload.mockReturnValue(null);
    mockLoadDashboardListPayload.mockResolvedValue([]);
    mockLoadDashboardDetailPayload.mockResolvedValue(null);
    mockUseRestRequest.mockImplementation((options: any) => ({
      data: options.initialData,
      loading: false,
      error: null,
      refetch: () =>
        options.request({
          signal: new AbortController().signal,
        }),
      cancel: jest.fn(),
      reset: jest.fn(),
      setData: jest.fn(),
    }));
  });

  it('builds request keys from executable dashboard scope inputs', () => {
    const selector = {
      workspaceId: 'ws-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snap-1',
      deployHash: 'deploy-1',
    };

    expect(
      buildDashboardListRequestKey({
        enabled: true,
        selector,
      }),
    ).toBe(
      '/api/v1/dashboards?workspaceId=ws-1&knowledgeBaseId=kb-1&kbSnapshotId=snap-1&deployHash=deploy-1',
    );
    expect(
      buildDashboardListRequestKey({
        enabled: false,
        selector,
      }),
    ).toBeNull();
    expect(
      buildDashboardDetailRequestKey({
        dashboardId: 42,
        enabled: true,
        selector,
      }),
    ).toBe(
      '/api/v1/dashboards/42?workspaceId=ws-1&knowledgeBaseId=kb-1&kbSnapshotId=snap-1&deployHash=deploy-1',
    );
  });

  it('passes the cached dashboard list payload into useRestRequest', () => {
    mockPeekDashboardListPayload.mockReturnValue([
      { id: 1, name: '增长看板', cacheEnabled: false },
    ]);

    const Harness = () => {
      useDashboardListData({
        enabled: true,
        selector: {
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
        initialData: [{ id: 1, name: '增长看板', cacheEnabled: false }],
        requestKey:
          '/api/v1/dashboards?workspaceId=ws-1&knowledgeBaseId=kb-1&kbSnapshotId=snap-1&deployHash=deploy-1',
      }),
    );
  });

  it('uses network refresh by default when dashboard list is manually refetched', async () => {
    let result: { refetch: () => Promise<unknown> } | null = null;

    const Harness = () => {
      result = useDashboardListData({
        enabled: true,
        selector: {
          workspaceId: 'ws-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snap-1',
          deployHash: 'deploy-1',
        },
      });
      return null;
    };

    renderToStaticMarkup(React.createElement(Harness));
    expect(result).not.toBeNull();
    await result!.refetch();

    expect(mockLoadDashboardListPayload).toHaveBeenCalledWith(
      expect.objectContaining({
        requestUrl:
          '/api/v1/dashboards?workspaceId=ws-1&knowledgeBaseId=kb-1&kbSnapshotId=snap-1&deployHash=deploy-1',
        useCache: false,
      }),
    );
  });

  it('passes the cached dashboard detail payload into useRestRequest', () => {
    mockPeekDashboardDetailPayload.mockReturnValue({
      id: 42,
      name: '销售看板',
      cacheEnabled: false,
      items: [],
    });

    const Harness = () => {
      useDashboardDetailData({
        dashboardId: 42,
        enabled: true,
        selector: {
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
        initialData: expect.objectContaining({
          id: 42,
          name: '销售看板',
        }),
        requestKey:
          '/api/v1/dashboards/42?workspaceId=ws-1&knowledgeBaseId=kb-1&kbSnapshotId=snap-1&deployHash=deploy-1',
      }),
    );
  });

  it('uses network refresh by default when dashboard detail is manually refetched', async () => {
    let result: { refetch: () => Promise<unknown> } | null = null;

    const Harness = () => {
      result = useDashboardDetailData({
        dashboardId: 42,
        enabled: true,
        selector: {
          workspaceId: 'ws-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snap-1',
          deployHash: 'deploy-1',
        },
      });
      return null;
    };

    renderToStaticMarkup(React.createElement(Harness));
    expect(result).not.toBeNull();
    await result!.refetch();

    expect(mockLoadDashboardDetailPayload).toHaveBeenCalledWith(
      expect.objectContaining({
        dashboardId: 42,
        requestUrl:
          '/api/v1/dashboards/42?workspaceId=ws-1&knowledgeBaseId=kb-1&kbSnapshotId=snap-1&deployHash=deploy-1',
        useCache: false,
      }),
    );
  });
});
