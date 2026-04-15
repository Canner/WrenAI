import {
  buildRuntimeScopeUrl,
  type ClientRuntimeScopeSelector,
} from '@/apollo/client/runtimeScope';
import type { CreateViewInput } from '@/apollo/client/graphql/__types__';

type ViewResponse = {
  id: number;
  name: string;
  statement: string;
  displayName: string;
};

export type ViewValidationResponse = {
  valid: boolean;
  message?: string;
};

export type ViewPreviewDataResponse = {
  columns: Array<{
    name: string;
    type: string;
  }>;
  data: any[][];
  cacheHit?: boolean;
  cacheCreatedAt?: string;
  cacheOverrodeAt?: string;
  override?: boolean;
};

type DeleteViewResponse = {
  success: boolean;
};

type ErrorPayload = {
  error?: string;
};

export const buildViewsCollectionUrl = (
  selector?: ClientRuntimeScopeSelector,
) => buildRuntimeScopeUrl('/api/v1/views', {}, selector);

export const buildViewValidationUrl = (selector?: ClientRuntimeScopeSelector) =>
  buildRuntimeScopeUrl('/api/v1/views/validate', {}, selector);

export const buildViewByIdUrl = (
  viewId: number,
  selector?: ClientRuntimeScopeSelector,
) => buildRuntimeScopeUrl(`/api/v1/views/${viewId}`, {}, selector);

export const buildViewPreviewUrl = (
  viewId: number,
  selector?: ClientRuntimeScopeSelector,
  limit?: number,
) =>
  buildRuntimeScopeUrl(
    `/api/v1/views/${viewId}/preview`,
    limit ? { limit } : {},
    selector,
  );

export const createViewFromResponse = async (
  selector: ClientRuntimeScopeSelector,
  data: CreateViewInput,
) => {
  const response = await fetch(buildViewsCollectionUrl(selector), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      (payload as ErrorPayload | null)?.error || '创建视图失败，请稍后重试',
    );
  }

  return payload as ViewResponse;
};

export const validateViewName = async (
  selector: ClientRuntimeScopeSelector,
  data: Pick<CreateViewInput, 'name'>,
) => {
  const response = await fetch(buildViewValidationUrl(selector), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      (payload as ErrorPayload | null)?.error || '校验视图名称失败，请稍后重试',
    );
  }

  return payload as ViewValidationResponse;
};

export const deleteViewById = async (
  selector: ClientRuntimeScopeSelector,
  viewId: number,
) => {
  const response = await fetch(buildViewByIdUrl(viewId, selector), {
    method: 'DELETE',
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      (payload as ErrorPayload | null)?.error || '删除视图失败，请稍后重试',
    );
  }

  return payload as DeleteViewResponse;
};

export const previewViewData = async (
  selector: ClientRuntimeScopeSelector,
  viewId: number,
  limit?: number,
) => {
  const response = await fetch(buildViewPreviewUrl(viewId, selector, limit), {
    method: 'GET',
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      (payload as ErrorPayload | null)?.error || '预览视图数据失败，请稍后重试',
    );
  }

  return payload as ViewPreviewDataResponse;
};
