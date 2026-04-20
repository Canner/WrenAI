import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import useAuthSession, {
  buildAuthSessionRequestKey,
  buildAuthSessionUrl,
} from './useAuthSession';

const mockUseRouter = jest.fn();
const mockUseRestRequest = jest.fn();

jest.mock('next/router', () => ({
  useRouter: () => mockUseRouter(),
}));

jest.mock('./useRestRequest', () => ({
  __esModule: true,
  default: (...args: any[]) => mockUseRestRequest(...args),
}));

describe('useAuthSession hook contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseRouter.mockReturnValue({
      isReady: true,
      query: {
        workspaceId: 'workspace-1',
      },
    });
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

  it('builds scope-aware session url and request key helpers', () => {
    expect(buildAuthSessionUrl('workspace-1')).toBe(
      '/api/auth/session?workspaceId=workspace-1',
    );
    expect(buildAuthSessionUrl(undefined)).toBe('/api/auth/session');

    expect(
      buildAuthSessionRequestKey({
        includeWorkspaceQuery: true,
        routerReady: true,
        workspaceId: 'workspace-1',
      }),
    ).toBe('workspace:workspace-1');

    expect(
      buildAuthSessionRequestKey({
        includeWorkspaceQuery: false,
        routerReady: true,
      }),
    ).toBe('global');

    expect(
      buildAuthSessionRequestKey({
        includeWorkspaceQuery: true,
        routerReady: false,
        workspaceId: 'workspace-1',
      }),
    ).toBeNull();
  });

  it('passes the derived request key into useRestRequest', () => {
    const Harness = () => {
      useAuthSession();
      return null;
    };

    renderToStaticMarkup(React.createElement(Harness));

    expect(mockUseRestRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        auto: true,
        requestKey: 'workspace:workspace-1',
        resetDataOnDisable: false,
      }),
    );
  });

  it('disables the request while the router is not ready', () => {
    mockUseRouter.mockReturnValue({
      isReady: false,
      query: {
        workspaceId: 'workspace-1',
      },
    });

    const Harness = () => {
      useAuthSession();
      return null;
    };

    renderToStaticMarkup(React.createElement(Harness));

    expect(mockUseRestRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: false,
        auto: false,
        requestKey: null,
      }),
    );
  });
});
