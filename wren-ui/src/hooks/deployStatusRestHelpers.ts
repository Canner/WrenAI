import type { ModelSyncResponse } from '@/types/project';

export const UNSYNCHRONIZED_RESULT = {
  data: {
    modelSync: {
      status: 'UNSYNCRONIZED',
    } as ModelSyncResponse,
  },
};

export const normalizeDeployStatusRefetchResult = (nextData?: {
  modelSync: ModelSyncResponse;
}) => ({
  data:
    nextData ||
    ({
      modelSync: UNSYNCHRONIZED_RESULT.data.modelSync,
    } as { modelSync: ModelSyncResponse }),
});

export const shouldContinueDeployStatusPolling = (intervalMs: number | null) =>
  typeof intervalMs === 'number' && intervalMs > 0;
