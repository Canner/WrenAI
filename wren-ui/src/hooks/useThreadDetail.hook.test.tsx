import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import useThreadDetail, {
  buildThreadDetailRequestKey,
} from './useThreadDetail';

const mockUseRestRequest = jest.fn();
const mockPeekThreadOverview = jest.fn();

jest.mock('./useRestRequest', () => ({
  __esModule: true,
  default: (...args: any[]) => mockUseRestRequest(...args),
}));

jest.mock('@/utils/runtimePagePrefetch', () => ({
  __esModule: true,
  peekThreadOverview: (...args: any[]) => mockPeekThreadOverview(...args),
  primeThreadOverview: jest.fn(),
}));

describe('useThreadDetail hook contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPeekThreadOverview.mockReturnValue(null);
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

  it('builds a request key only for enabled thread detail requests', () => {
    expect(
      buildThreadDetailRequestKey({
        enabled: false,
        threadId: 42,
        runtimeScopeSelector: { workspaceId: 'ws-1' },
      }),
    ).toBeNull();

    expect(
      buildThreadDetailRequestKey({
        enabled: true,
        threadId: null,
        runtimeScopeSelector: { workspaceId: 'ws-1' },
      }),
    ).toBeNull();

    expect(
      buildThreadDetailRequestKey({
        enabled: true,
        threadId: 42,
        runtimeScopeSelector: {
          workspaceId: 'ws-1',
          knowledgeBaseId: 'kb-1',
        },
      }),
    ).toBe('/api/v1/threads/42?workspaceId=ws-1&knowledgeBaseId=kb-1');
  });

  it('auto-fetches when no prefetched thread detail exists', () => {
    const Harness = () => {
      useThreadDetail({
        threadId: 42,
        enabled: true,
        runtimeScopeSelector: { workspaceId: 'ws-1' },
      });
      return null;
    };

    renderToStaticMarkup(React.createElement(Harness));

    expect(mockUseRestRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        auto: true,
        initialData: null,
        requestKey: '/api/v1/threads/42?workspaceId=ws-1',
      }),
    );
  });

  it('skips auto-fetch when prefetched thread detail is already hydrated', () => {
    mockPeekThreadOverview.mockReturnValue({
      thread: {
        id: 42,
        summary: '线程摘要',
        responses: [{ id: 1 }],
        knowledgeBaseIds: ['kb-1'],
        selectedSkillIds: [],
      },
    });

    const Harness = () => {
      useThreadDetail({
        threadId: 42,
        enabled: true,
        runtimeScopeSelector: { workspaceId: 'ws-1' },
      });
      return null;
    };

    renderToStaticMarkup(React.createElement(Harness));

    expect(mockUseRestRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        auto: false,
        initialData: {
          thread: expect.objectContaining({
            id: 42,
          }),
        },
      }),
    );
  });

  it('revalidates prefetched empty thread detail payloads', () => {
    mockPeekThreadOverview.mockReturnValue({
      thread: {
        id: 42,
        summary: '线程摘要',
        responses: [],
        knowledgeBaseIds: ['kb-1'],
        selectedSkillIds: [],
      },
    });

    const Harness = () => {
      useThreadDetail({
        threadId: 42,
        enabled: true,
        runtimeScopeSelector: { workspaceId: 'ws-1' },
      });
      return null;
    };

    renderToStaticMarkup(React.createElement(Harness));

    expect(mockUseRestRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        auto: true,
        initialData: {
          thread: expect.objectContaining({
            id: 42,
            responses: [],
          }),
        },
      }),
    );
  });
});
