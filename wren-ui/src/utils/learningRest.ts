import {
  buildRuntimeScopeUrl,
  resolveClientRuntimeScopeSelector,
  type ClientRuntimeScopeSelector,
} from '@/apollo/client/runtimeScope';
import { parseRestJsonResponse } from './rest';

export type LearningRecordData = {
  paths: string[];
};

const normalizeLearningRecord = (payload: unknown): LearningRecordData => {
  if (!payload || typeof payload !== 'object') {
    return { paths: [] };
  }

  const source = payload as { paths?: unknown };
  return {
    paths: Array.isArray(source.paths)
      ? source.paths.filter((path): path is string => typeof path === 'string')
      : [],
  };
};

export const buildLearningUrl = (
  selector = resolveClientRuntimeScopeSelector(),
) => buildRuntimeScopeUrl('/api/v1/learning', {}, selector);

export const fetchLearningRecord = async (
  selector: ClientRuntimeScopeSelector = resolveClientRuntimeScopeSelector(),
) => {
  const response = await fetch(buildLearningUrl(selector));
  const payload = await parseRestJsonResponse<unknown>(
    response,
    '加载学习记录失败，请稍后重试。',
  );
  return normalizeLearningRecord(payload);
};

export const saveLearningRecord = async (
  selector: ClientRuntimeScopeSelector,
  path: string,
) => {
  const response = await fetch(buildLearningUrl(selector), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });
  const payload = await parseRestJsonResponse<unknown>(
    response,
    '保存学习记录失败，请稍后重试。',
  );
  return normalizeLearningRecord(payload);
};
