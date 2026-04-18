import {
  buildRuntimeScopeUrl,
  type ClientRuntimeScopeSelector,
} from '@/runtime/client/runtimeScope';

export type ModelPreviewDataResponse = {
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

type ErrorPayload = {
  error?: string;
};

export const buildModelPreviewUrl = (
  modelId: number,
  selector?: ClientRuntimeScopeSelector,
  limit?: number,
) =>
  buildRuntimeScopeUrl(
    `/api/v1/models/${modelId}/preview`,
    limit ? { limit } : {},
    selector,
  );

export const previewModelData = async (
  selector: ClientRuntimeScopeSelector,
  modelId: number,
  limit?: number,
) => {
  const response = await fetch(buildModelPreviewUrl(modelId, selector, limit), {
    method: 'GET',
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      (payload as ErrorPayload | null)?.error || '预览模型数据失败，请稍后重试',
    );
  }

  return payload as ModelPreviewDataResponse;
};
