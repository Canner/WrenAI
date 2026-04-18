import {
  buildRuntimeScopeUrl,
  resolveClientRuntimeScopeSelector,
  type ClientRuntimeScopeSelector,
} from '@/runtime/client/runtimeScope';
import { parseRestJsonResponse } from './rest';

export type DashboardScheduleData = {
  frequency: string;
  day?: string | null;
  hour?: number | null;
  minute?: number | null;
  cron?: string | null;
  timezone?: string | null;
};

export type DashboardItemLayoutInput = {
  itemId: number;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type DashboardGridItemData = {
  id: number;
  dashboardId: number;
  type: string;
  displayName?: string | null;
  layout: {
    x: number;
    y: number;
    w: number;
    h: number;
  };
  detail: {
    sql: string;
    chartSchema?: any | null;
    renderHints?: Record<string, unknown> | null;
    canonicalizationVersion?: string | null;
    chartDataProfile?: Record<string, unknown> | null;
    validationErrors?: string[] | null;
    sourceResponseId?: number | null;
    sourceThreadId?: number | null;
    sourceQuestion?: string | null;
  };
};

export type DashboardListItem = {
  id: number;
  name: string;
  cacheEnabled: boolean;
  nextScheduledAt?: string | null;
  scheduleFrequency?: string | null;
};

export type DashboardDetailData = DashboardListItem & {
  description?: string | null;
  schedule?: DashboardScheduleData | null;
  items: DashboardGridItemData[];
};

export type DashboardPreviewData = {
  chartDataProfile?: Record<string, unknown> | null;
  cacheHit?: boolean;
  cacheCreatedAt?: string | null;
  cacheOverrodeAt?: string | null;
  override?: boolean;
  data: Array<Record<string, unknown>>;
};

type TimedCacheEntry<TPayload> = {
  value: TPayload;
  updatedAt: number;
};

const DASHBOARD_CACHE_TTL_MS = 30_000;
const dashboardListCache = new Map<
  string,
  TimedCacheEntry<DashboardListItem[]>
>();
const dashboardListRequests = new Map<string, Promise<DashboardListItem[]>>();
const dashboardDetailCache = new Map<
  string,
  TimedCacheEntry<DashboardDetailData>
>();
const dashboardDetailRequests = new Map<string, Promise<DashboardDetailData>>();

const getFreshCachedValue = <TPayload>(
  cache: Map<string, TimedCacheEntry<TPayload>>,
  requestUrl: string,
) => {
  const cached = cache.get(requestUrl);
  if (!cached) {
    return null;
  }

  if (Date.now() - cached.updatedAt > DASHBOARD_CACHE_TTL_MS) {
    cache.delete(requestUrl);
    return null;
  }

  return cached.value;
};

export const clearDashboardRestCache = () => {
  dashboardListCache.clear();
  dashboardListRequests.clear();
  dashboardDetailCache.clear();
  dashboardDetailRequests.clear();
};

export const buildDashboardListUrl = (
  selector = resolveClientRuntimeScopeSelector(),
) => buildRuntimeScopeUrl('/api/v1/dashboards', {}, selector);

export const buildDashboardDetailUrl = (
  dashboardId: number,
  selector = resolveClientRuntimeScopeSelector(),
) => buildRuntimeScopeUrl(`/api/v1/dashboards/${dashboardId}`, {}, selector);

export const buildDashboardScheduleUrl = (
  dashboardId: number,
  selector = resolveClientRuntimeScopeSelector(),
) =>
  buildRuntimeScopeUrl(
    `/api/v1/dashboards/${dashboardId}/schedule`,
    {},
    selector,
  );

export const buildDashboardItemLayoutsUrl = (
  selector = resolveClientRuntimeScopeSelector(),
) => buildRuntimeScopeUrl('/api/v1/dashboard-items/layouts', {}, selector);

export const buildDashboardItemUrl = (
  itemId: number,
  selector = resolveClientRuntimeScopeSelector(),
) => buildRuntimeScopeUrl(`/api/v1/dashboard-items/${itemId}`, {}, selector);

export const buildDashboardItemPreviewUrl = (
  itemId: number,
  selector = resolveClientRuntimeScopeSelector(),
) =>
  buildRuntimeScopeUrl(
    `/api/v1/dashboard-items/${itemId}/preview`,
    {},
    selector,
  );

export const peekDashboardListPayload = ({
  selector,
  requestUrl,
}: {
  selector?: ClientRuntimeScopeSelector;
  requestUrl?: string;
}) => {
  const resolvedRequestUrl = requestUrl || buildDashboardListUrl(selector);
  return getFreshCachedValue(dashboardListCache, resolvedRequestUrl);
};

export const primeDashboardListPayload = ({
  selector,
  requestUrl,
  payload,
}: {
  selector?: ClientRuntimeScopeSelector;
  requestUrl?: string;
  payload: DashboardListItem[];
}) => {
  const resolvedRequestUrl = requestUrl || buildDashboardListUrl(selector);
  dashboardListCache.set(resolvedRequestUrl, {
    value: payload,
    updatedAt: Date.now(),
  });
};

export const peekDashboardDetailPayload = ({
  selector,
  requestUrl,
  dashboardId,
}: {
  selector?: ClientRuntimeScopeSelector;
  requestUrl?: string;
  dashboardId?: number;
}) => {
  const resolvedRequestUrl =
    requestUrl ||
    (dashboardId != null
      ? buildDashboardDetailUrl(dashboardId, selector)
      : null);
  if (!resolvedRequestUrl) {
    return null;
  }

  return getFreshCachedValue(dashboardDetailCache, resolvedRequestUrl);
};

export const primeDashboardDetailPayload = ({
  selector,
  requestUrl,
  dashboardId,
  payload,
}: {
  selector?: ClientRuntimeScopeSelector;
  requestUrl?: string;
  dashboardId?: number;
  payload: DashboardDetailData;
}) => {
  const resolvedRequestUrl =
    requestUrl ||
    (dashboardId != null
      ? buildDashboardDetailUrl(dashboardId, selector)
      : null);
  if (!resolvedRequestUrl) {
    return;
  }

  dashboardDetailCache.set(resolvedRequestUrl, {
    value: payload,
    updatedAt: Date.now(),
  });
};

export const loadDashboardListPayload = async ({
  selector,
  requestUrl,
  fetcher = fetch,
  useCache = true,
}: {
  selector?: ClientRuntimeScopeSelector;
  requestUrl?: string;
  fetcher?: typeof fetch;
  useCache?: boolean;
}) => {
  const resolvedRequestUrl = requestUrl || buildDashboardListUrl(selector);

  if (useCache) {
    const cachedPayload = getFreshCachedValue(
      dashboardListCache,
      resolvedRequestUrl,
    );
    if (cachedPayload) {
      return cachedPayload;
    }
  }

  const pendingRequest = dashboardListRequests.get(resolvedRequestUrl);
  if (pendingRequest) {
    return pendingRequest;
  }

  const request = fetcher(resolvedRequestUrl)
    .then((response) =>
      parseRestJsonResponse<DashboardListItem[]>(
        response,
        '加载看板列表失败，请稍后重试。',
      ),
    )
    .then((payload) => {
      primeDashboardListPayload({ requestUrl: resolvedRequestUrl, payload });
      return payload;
    })
    .finally(() => {
      dashboardListRequests.delete(resolvedRequestUrl);
    });

  dashboardListRequests.set(resolvedRequestUrl, request);
  return request;
};

export const loadDashboardDetailPayload = async ({
  dashboardId,
  selector,
  requestUrl,
  fetcher = fetch,
  useCache = true,
}: {
  dashboardId: number;
  selector?: ClientRuntimeScopeSelector;
  requestUrl?: string;
  fetcher?: typeof fetch;
  useCache?: boolean;
}) => {
  const resolvedRequestUrl =
    requestUrl || buildDashboardDetailUrl(dashboardId, selector);

  if (useCache) {
    const cachedPayload = getFreshCachedValue(
      dashboardDetailCache,
      resolvedRequestUrl,
    );
    if (cachedPayload) {
      return cachedPayload;
    }
  }

  const pendingRequest = dashboardDetailRequests.get(resolvedRequestUrl);
  if (pendingRequest) {
    return pendingRequest;
  }

  const request = fetcher(resolvedRequestUrl)
    .then((response) =>
      parseRestJsonResponse<DashboardDetailData>(
        response,
        '加载看板详情失败，请稍后重试。',
      ),
    )
    .then((payload) => {
      primeDashboardDetailPayload({
        requestUrl: resolvedRequestUrl,
        dashboardId,
        payload,
      });
      return payload;
    })
    .finally(() => {
      dashboardDetailRequests.delete(resolvedRequestUrl);
    });

  dashboardDetailRequests.set(resolvedRequestUrl, request);
  return request;
};

export const createDashboard = async (
  selector: ClientRuntimeScopeSelector,
  data: { name: string },
) => {
  const response = await fetch(buildDashboardListUrl(selector), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  return parseRestJsonResponse<DashboardListItem>(
    response,
    '创建看板失败，请稍后重试。',
  );
};

export const updateDashboardSchedule = async (
  selector: ClientRuntimeScopeSelector,
  dashboardId: number,
  data: {
    cacheEnabled: boolean;
    schedule?: DashboardScheduleData | null;
  },
) => {
  const response = await fetch(
    buildDashboardScheduleUrl(dashboardId, selector),
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    },
  );

  return parseRestJsonResponse<DashboardListItem & Record<string, any>>(
    response,
    '更新看板调度失败，请稍后重试。',
  );
};

export const updateDashboardItem = async (
  selector: ClientRuntimeScopeSelector,
  itemId: number,
  data: { displayName: string },
) => {
  const response = await fetch(buildDashboardItemUrl(itemId, selector), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  return parseRestJsonResponse<DashboardGridItemData>(
    response,
    '更新看板图表失败，请稍后重试。',
  );
};

export const deleteDashboardItem = async (
  selector: ClientRuntimeScopeSelector,
  itemId: number,
) => {
  const response = await fetch(buildDashboardItemUrl(itemId, selector), {
    method: 'DELETE',
  });

  return parseRestJsonResponse<{ success: boolean }>(
    response,
    '删除看板项失败，请稍后重试。',
  );
};

export const updateDashboardItemLayouts = async (
  selector: ClientRuntimeScopeSelector,
  layouts: DashboardItemLayoutInput[],
) => {
  const response = await fetch(buildDashboardItemLayoutsUrl(selector), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ layouts }),
  });

  return parseRestJsonResponse<DashboardGridItemData[]>(
    response,
    '更新看板布局失败，请稍后重试。',
  );
};

export const previewDashboardItem = async (
  selector: ClientRuntimeScopeSelector,
  itemId: number,
  data: { limit?: number; refresh?: boolean } = {},
) => {
  const response = await fetch(buildDashboardItemPreviewUrl(itemId, selector), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  return parseRestJsonResponse<DashboardPreviewData>(
    response,
    '加载看板图表失败，请稍后重试。',
  );
};
