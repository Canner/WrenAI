import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import useWorkspaceGovernanceOverview, {
  buildWorkspaceGovernanceOverviewRequestKey,
  buildWorkspaceGovernanceOverviewUrl,
} from './useWorkspaceGovernanceOverview';

const mockMessageError = jest.fn();
const mockUseRestRequest = jest.fn();

jest.mock('antd', () => ({
  message: {
    error: (...args: any[]) => mockMessageError(...args),
  },
}));

jest.mock('@/hooks/useRestRequest', () => ({
  __esModule: true,
  default: (...args: any[]) => mockUseRestRequest(...args),
}));

describe('useWorkspaceGovernanceOverview helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseRestRequest.mockReturnValue({
      data: null,
      loading: false,
      refetch: jest.fn(),
      error: null,
    });
  });

  it('builds the workspace overview url and request key only when enabled', () => {
    expect(
      buildWorkspaceGovernanceOverviewUrl({
        enabled: false,
      }),
    ).toBeNull();
    expect(
      buildWorkspaceGovernanceOverviewRequestKey({
        enabled: false,
      }),
    ).toBeNull();

    expect(
      buildWorkspaceGovernanceOverviewUrl({
        enabled: true,
      }),
    ).toBe('/api/v1/workspace/current');
    expect(
      buildWorkspaceGovernanceOverviewRequestKey({
        enabled: true,
      }),
    ).toBe('/api/v1/workspace/current');
  });

  it('passes the derived request key and error handler into useRestRequest', () => {
    const Harness = () => {
      useWorkspaceGovernanceOverview({
        enabled: true,
        errorMessage: '加载工作空间概览失败',
      });
      return null;
    };

    renderToStaticMarkup(React.createElement(Harness));

    expect(mockUseRestRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        initialData: null,
        requestKey: '/api/v1/workspace/current',
        onError: expect.any(Function),
      }),
    );
  });

  it('reports resolved request errors through antd message', () => {
    let onError: ((error: Error) => void) | undefined;
    mockUseRestRequest.mockImplementation((args: any) => {
      onError = args.onError;
      return {
        data: null,
        loading: false,
        refetch: jest.fn(),
        error: null,
      };
    });

    const Harness = () => {
      useWorkspaceGovernanceOverview({
        enabled: true,
        errorMessage: '加载工作空间概览失败',
      });
      return null;
    };

    renderToStaticMarkup(React.createElement(Harness));
    onError?.(new Error('加载工作空间概览失败'));

    expect(mockMessageError).toHaveBeenCalledWith('加载工作空间概览失败');
  });
});
