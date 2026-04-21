import {
  deleteHomeSidebarThread,
  loadHomeSidebarThreadsPayload,
  renameHomeSidebarThread,
} from './homeSidebarRequests';

describe('homeSidebarRequests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('loads and normalizes sidebar thread payloads through the shared request helper', async () => {
    const fetcher = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          id: 1,
          summary: '收入分析',
          workspaceId: 'ws-1',
          knowledgeBaseId: 'kb-1',
        },
      ],
    });

    await expect(
      loadHomeSidebarThreadsPayload({
        requestUrl: '/api/v1/threads?workspaceId=ws-1',
        cacheMode: 'no-store',
        fetcher,
      }),
    ).resolves.toEqual([
      {
        id: 1,
        summary: '收入分析',
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-1',
      },
    ]);
    expect(fetcher).toHaveBeenCalledWith('/api/v1/threads?workspaceId=ws-1', {
      cache: 'no-store',
      signal: undefined,
    });
  });

  it('retries transient runtime scope failures when loading sidebar threads', async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({
          error: 'Workspace scope could not be resolved',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            id: 1,
            summary: '收入分析',
            workspaceId: 'ws-1',
            knowledgeBaseId: 'kb-1',
          },
        ],
      });

    await expect(
      loadHomeSidebarThreadsPayload({
        requestUrl: '/api/v1/threads?workspaceId=ws-1',
        fetcher,
      }),
    ).resolves.toEqual([
      {
        id: 1,
        summary: '收入分析',
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-1',
      },
    ]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('renames a sidebar thread through the shared mutation helper', async () => {
    const fetcher = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });

    await expect(
      renameHomeSidebarThread({
        id: 'thread-1',
        summary: '新的标题',
        selector: {
          workspaceId: 'ws-1',
          knowledgeBaseId: 'kb-1',
        },
        fetcher,
      }),
    ).resolves.toBeUndefined();

    expect(fetcher).toHaveBeenCalledWith(
      '/api/v1/threads/thread-1?workspaceId=ws-1&knowledgeBaseId=kb-1',
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ summary: '新的标题' }),
      },
    );
  });

  it('deletes a sidebar thread through the shared mutation helper', async () => {
    const fetcher = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });

    await expect(
      deleteHomeSidebarThread({
        id: 'thread-1',
        selector: {
          workspaceId: 'ws-1',
        },
        fetcher,
      }),
    ).resolves.toBeUndefined();

    expect(fetcher).toHaveBeenCalledWith(
      '/api/v1/threads/thread-1?workspaceId=ws-1',
      {
        method: 'DELETE',
      },
    );
  });

  it('throws the sidebar-specific fallback message when the thread mutation fails', async () => {
    const fetcher = jest.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: undefined }),
    });

    await expect(
      renameHomeSidebarThread({
        id: 'thread-1',
        summary: '新的标题',
        selector: {
          workspaceId: 'ws-1',
        },
        fetcher,
      }),
    ).rejects.toThrow('更新对话失败，请稍后重试');
  });
});
