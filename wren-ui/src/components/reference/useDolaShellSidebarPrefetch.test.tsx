import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import useDolaShellSidebarPrefetch from './useDolaShellSidebarPrefetch';

const mockPrefetchDashboardOverview = jest.fn();
const mockPrefetchKnowledgeOverview = jest.fn();
const mockPrefetchThreadOverview = jest.fn();
const mockPrefetchWorkspaceOverview = jest.fn();
const mockResolveShellPrefetchUrls = jest.fn();
const mockResolveBackgroundNavPrefetchKeys = jest.fn();
const mockResolveBackgroundHistoryPrefetchIds = jest.fn();

jest.mock('@/utils/runtimePagePrefetch', () => ({
  prefetchDashboardOverview: (...args: any[]) =>
    mockPrefetchDashboardOverview(...args),
  prefetchKnowledgeOverview: (...args: any[]) =>
    mockPrefetchKnowledgeOverview(...args),
  prefetchThreadOverview: (...args: any[]) =>
    mockPrefetchThreadOverview(...args),
  prefetchWorkspaceOverview: (...args: any[]) =>
    mockPrefetchWorkspaceOverview(...args),
}));

jest.mock('./dolaShellUtils', () => ({
  resolveShellPrefetchUrls: (...args: any[]) =>
    mockResolveShellPrefetchUrls(...args),
  resolveBackgroundNavPrefetchKeys: (...args: any[]) =>
    mockResolveBackgroundNavPrefetchKeys(...args),
  resolveBackgroundHistoryPrefetchIds: (...args: any[]) =>
    mockResolveBackgroundHistoryPrefetchIds(...args),
  resolveHistoryThreadHref: jest.fn(),
  resolveHistoryThreadNavigationSelector: jest.fn(),
}));

describe('useDolaShellSidebarPrefetch', () => {
  const originalWindow = global.window;
  const originalFetch = global.fetch;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveShellPrefetchUrls.mockReturnValue([
      '/home?workspaceId=workspace-1',
      '/knowledge?workspaceId=workspace-1',
    ]);
    mockResolveBackgroundNavPrefetchKeys.mockReturnValue([]);
    mockResolveBackgroundHistoryPrefetchIds.mockReturnValue([]);
  });

  afterEach(() => {
    Object.defineProperty(process.env, 'NODE_ENV', {
      value: originalNodeEnv,
      configurable: true,
    });
    global.window = originalWindow;
    global.fetch = originalFetch;
  });

  const renderHookHarness = (router: {
    prefetch?: (url: string) => Promise<unknown>;
    pathname?: string;
  }) => {
    const Harness = () => {
      useDolaShellSidebarPrefetch({
        navItems: [],
        uniqueHistory: [],
        historyItemById: new Map(),
        scopeKey: 'workspace-1',
        hrefWorkspace: (path) => path,
        hrefRuntime: (path) => path,
        router: {
          pathname: '/home',
          ...router,
        } as any,
        hasRuntimeScope: true,
        runtimeSelector: { workspaceId: 'workspace-1' },
        workspaceScopedSelector: { workspaceId: 'workspace-1' },
      });
      return null;
    };

    const useEffectSpy = jest
      .spyOn(React, 'useEffect')
      .mockImplementation(((effect: () => void) => effect()) as any);

    renderToStaticMarkup(<Harness />);
    useEffectSpy.mockRestore();
  };

  it('prefetches canonical shell routes with router.prefetch when available', () => {
    global.window = {} as any;
    const routerPrefetch = jest.fn().mockResolvedValue(true);

    renderHookHarness({
      prefetch: routerPrefetch,
    });

    expect(routerPrefetch).toHaveBeenCalledWith(
      '/home?workspaceId=workspace-1',
    );
    expect(routerPrefetch).toHaveBeenCalledWith(
      '/knowledge?workspaceId=workspace-1',
    );
  });

  it('warms shell routes with fetch in development when router.prefetch is unavailable', () => {
    Object.defineProperty(process.env, 'NODE_ENV', {
      value: 'development',
      configurable: true,
    });
    global.window = {} as any;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => '',
    } as any);

    renderHookHarness({});

    expect(global.fetch).toHaveBeenCalledWith(
      '/home?workspaceId=workspace-1',
      expect.objectContaining({
        credentials: 'include',
      }),
    );
    expect(global.fetch).toHaveBeenCalledWith(
      '/knowledge?workspaceId=workspace-1',
      expect.objectContaining({
        credentials: 'include',
      }),
    );
  });

  it('prefers the full runtime selector when prefetching dashboard data', () => {
    global.window = {
      requestIdleCallback: (callback: IdleRequestCallback) => {
        callback({
          didTimeout: false,
          timeRemaining: () => 50,
        } as IdleDeadline);
        return 1;
      },
      cancelIdleCallback: jest.fn(),
    } as any;
    mockResolveBackgroundNavPrefetchKeys.mockReturnValue(['dashboard']);

    const Harness = () => {
      useDolaShellSidebarPrefetch({
        navItems: [],
        uniqueHistory: [],
        historyItemById: new Map(),
        scopeKey: 'workspace-1',
        hrefWorkspace: (path) => path,
        hrefRuntime: (path) => path,
        router: {
          pathname: '/home',
        } as any,
        hasRuntimeScope: true,
        runtimeSelector: {
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snap-1',
          deployHash: 'deploy-1',
        },
        workspaceScopedSelector: { workspaceId: 'workspace-1' },
      });
      return null;
    };

    const useEffectSpy = jest
      .spyOn(React, 'useEffect')
      .mockImplementation(((effect: () => void) => effect()) as any);

    renderToStaticMarkup(<Harness />);
    useEffectSpy.mockRestore();

    expect(mockPrefetchDashboardOverview).toHaveBeenCalledWith({
      selector: {
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snap-1',
        deployHash: 'deploy-1',
      },
    });
  });

  it('prefetches knowledge data without warming the diagram endpoint', () => {
    global.window = {
      requestIdleCallback: (callback: IdleRequestCallback) => {
        callback({
          didTimeout: false,
          timeRemaining: () => 50,
        } as IdleDeadline);
        return 1;
      },
      cancelIdleCallback: jest.fn(),
    } as any;
    mockResolveBackgroundNavPrefetchKeys.mockReturnValue(['knowledge']);

    const Harness = () => {
      useDolaShellSidebarPrefetch({
        navItems: [],
        uniqueHistory: [],
        historyItemById: new Map(),
        scopeKey: 'workspace-1',
        hrefWorkspace: (path) => path,
        hrefRuntime: (path) => path,
        router: {
          pathname: '/home',
        } as any,
        hasRuntimeScope: true,
        runtimeSelector: {
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snap-1',
          deployHash: 'deploy-1',
        },
        workspaceScopedSelector: { workspaceId: 'workspace-1' },
      });
      return null;
    };

    const useEffectSpy = jest
      .spyOn(React, 'useEffect')
      .mockImplementation(((effect: () => void) => effect()) as any);

    renderToStaticMarkup(<Harness />);
    useEffectSpy.mockRestore();

    expect(mockPrefetchKnowledgeOverview).toHaveBeenCalledWith({
      knowledgeBasesUrl: '/api/v1/knowledge/bases?workspaceId=workspace-1',
    });
  });
});
