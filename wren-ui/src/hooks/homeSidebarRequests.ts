import {
  parseRestJsonResponse,
  withTransientRuntimeScopeRetry,
} from '@/utils/rest';
import {
  buildHomeSidebarThreadDetailUrl,
  normalizeHomeSidebarThreads,
  type HomeSidebarThreadRecord,
} from './homeSidebarHelpers';
import type { ClientRuntimeScopeSelector } from '@/runtime/client/runtimeScope';

export const loadHomeSidebarThreadsPayload = async ({
  requestUrl,
  cacheMode = 'default',
  signal,
  fetcher = fetch,
}: {
  requestUrl: string;
  cacheMode?: RequestCache;
  signal?: AbortSignal;
  fetcher?: typeof fetch;
}) => {
  const payload = await withTransientRuntimeScopeRetry({
    signal,
    loader: async () => {
      const response = await fetcher(requestUrl, {
        cache: cacheMode,
        signal,
      });
      return parseRestJsonResponse<unknown>(
        response,
        '加载历史对话失败，请稍后重试',
      );
    },
  });

  return normalizeHomeSidebarThreads(payload) as HomeSidebarThreadRecord[];
};

export const renameHomeSidebarThread = async ({
  id,
  summary,
  selector,
  fetcher = fetch,
}: {
  id: string;
  summary: string;
  selector: ClientRuntimeScopeSelector;
  fetcher?: typeof fetch;
}) => {
  const response = await fetcher(
    buildHomeSidebarThreadDetailUrl(id, selector),
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ summary }),
    },
  );

  await parseRestJsonResponse<unknown>(response, '更新对话失败，请稍后重试');
};

export const deleteHomeSidebarThread = async ({
  id,
  selector,
  fetcher = fetch,
}: {
  id: string;
  selector: ClientRuntimeScopeSelector;
  fetcher?: typeof fetch;
}) => {
  const response = await fetcher(
    buildHomeSidebarThreadDetailUrl(id, selector),
    {
      method: 'DELETE',
    },
  );

  await parseRestJsonResponse<unknown>(response, '删除对话失败，请稍后重试');
};
