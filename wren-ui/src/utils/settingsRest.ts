import { SampleDatasetName, DataSourceName } from '@/types/dataSource';
import {
  buildRuntimeScopeUrl,
  resolveClientRuntimeScopeSelector,
  type ClientRuntimeScopeSelector,
} from '@/runtime/client/runtimeScope';

import { parseRestJsonResponse } from './rest';

export type KnowledgeConnectionSettings = {
  type?: DataSourceName | null;
  properties?: Record<string, any> | null;
  sampleDataset?: SampleDatasetName | null;
};

export type SettingsData = {
  productVersion?: string | null;
  connection?: KnowledgeConnectionSettings | null;
  language?: string | null;
};

export type StartSampleDatasetResponse = {
  name: string;
  projectId: number;
  runtimeScopeId?: string | null;
};

export const buildSettingsUrl = (
  selector = resolveClientRuntimeScopeSelector(),
) => buildRuntimeScopeUrl('/api/v1/settings', {}, selector);

export const buildProjectSettingsUrl = (
  selector = resolveClientRuntimeScopeSelector(),
) => buildRuntimeScopeUrl('/api/v1/settings/project', {}, selector);

export const buildKnowledgeConnectionSettingsUrl = (
  selector = resolveClientRuntimeScopeSelector(),
) => buildRuntimeScopeUrl('/api/v1/settings/connection', {}, selector);

export const buildSampleDatasetUrl = (
  selector = resolveClientRuntimeScopeSelector(),
) => buildRuntimeScopeUrl('/api/v1/settings/sample-dataset', {}, selector);

export const fetchSettings = async (
  selector: ClientRuntimeScopeSelector = resolveClientRuntimeScopeSelector(),
) => {
  const response = await fetch(buildSettingsUrl(selector));
  const payload = await parseRestJsonResponse<SettingsData>(
    response,
    '加载系统设置失败，请稍后重试。',
  );
  return normalizeSettingsData(payload);
};

export const resolveSettingsConnection = (
  settings?: SettingsData | null,
): KnowledgeConnectionSettings | null => settings?.connection ?? null;

export const normalizeSettingsData = (
  settings?: SettingsData | null,
): SettingsData | null => {
  if (!settings) {
    return null;
  }
  return settings;
};

export const updateCurrentProjectLanguage = async (
  selector: ClientRuntimeScopeSelector,
  language: string,
) => {
  const response = await fetch(buildProjectSettingsUrl(selector), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ language }),
  });

  return parseRestJsonResponse<{ success: boolean }>(
    response,
    '更新知识库语言失败，请稍后重试。',
  );
};

export const resetCurrentProject = async (
  selector: ClientRuntimeScopeSelector,
) => {
  const response = await fetch(buildProjectSettingsUrl(selector), {
    method: 'DELETE',
  });

  return parseRestJsonResponse<{ success: boolean }>(
    response,
    '重置知识库失败，请稍后重试。',
  );
};

export const updateKnowledgeConnectionSettings = async (
  selector: ClientRuntimeScopeSelector,
  {
    properties,
    type,
  }: {
    properties: Record<string, any>;
    type?: DataSourceName | null;
  },
) => {
  const response = await fetch(buildKnowledgeConnectionSettingsUrl(selector), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...(type ? { type } : {}),
      properties,
    }),
  });

  return parseRestJsonResponse<KnowledgeConnectionSettings>(
    response,
    '更新知识库连接失败，请稍后重试。',
  );
};

export const startSampleDataset = async (
  selector: ClientRuntimeScopeSelector,
  name: SampleDatasetName,
) => {
  const response = await fetch(buildSampleDatasetUrl(selector), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });

  return parseRestJsonResponse<StartSampleDatasetResponse>(
    response,
    '导入样例数据失败，请稍后重试。',
  );
};
