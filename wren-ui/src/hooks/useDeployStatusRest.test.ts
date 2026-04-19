import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import useDeployStatusRest, {
  buildDeployStatusRequestKey,
} from './useDeployStatusRest';

const mockUseRuntimeScopeNavigation = jest.fn();
const mockUseRestRequest = jest.fn();

jest.mock('./useRuntimeScopeNavigation', () => ({
  __esModule: true,
  default: () => mockUseRuntimeScopeNavigation(),
}));

jest.mock('./useRestRequest', () => ({
  __esModule: true,
  default: (...args: any[]) => mockUseRestRequest(...args),
}));

describe('useDeployStatusRest', () => {
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
      data: { modelSync: { status: 'SUCCESS' } },
      loading: false,
      refetch: jest
        .fn()
        .mockResolvedValue({ modelSync: { status: 'SUCCESS' } }),
      setData: jest.fn(),
    });
  });

  it('builds a deploy-status request key only for executable runtime scopes', () => {
    expect(
      buildDeployStatusRequestKey({
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snap-1',
        deployHash: 'deploy-1',
      }),
    ).toBe('workspace-1|kb-1|snap-1|deploy-1');

    expect(
      buildDeployStatusRequestKey({
        workspaceId: 'workspace-1',
      }),
    ).toBeNull();
  });

  it('passes the derived request key into useRestRequest', () => {
    const Harness = () => {
      useDeployStatusRest();
      return null;
    };

    renderToStaticMarkup(React.createElement(Harness));

    expect(mockUseRestRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        auto: true,
        initialData: undefined,
        requestKey: 'workspace-1|kb-1|snap-1|deploy-1',
      }),
    );
  });

  it('falls back to an unsynchronized result when scope is not executable', async () => {
    const setData = jest.fn();
    mockUseRuntimeScopeNavigation.mockReturnValue({
      selector: {
        workspaceId: 'workspace-1',
      },
    });
    mockUseRestRequest.mockReturnValue({
      data: undefined,
      loading: false,
      refetch: jest.fn(),
      setData,
    });

    let current: ReturnType<typeof useDeployStatusRest> | null = null;
    const Harness = () => {
      current = useDeployStatusRest();
      return null;
    };

    renderToStaticMarkup(React.createElement(Harness));

    const result = await current!.refetch();

    expect(setData).toHaveBeenCalledWith(undefined);
    expect(result).toEqual({
      data: {
        modelSync: {
          status: 'UNSYNCRONIZED',
        },
      },
    });
    expect(mockUseRestRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: false,
        requestKey: null,
      }),
    );
  });
});
