import {
  buildRuntimeScopeUrl,
  resolveClientRuntimeScopeSelector,
  type ClientRuntimeScopeSelector,
} from '@/apollo/client/runtimeScope';
import type {
  DataSourceName,
  SampleDatasetName,
} from '@/apollo/client/graphql/__types__';
import { parseRestJsonResponse } from './rest';

export type SettingsData = {
  productVersion?: string | null;
  dataSource?: {
    type?: DataSourceName | null;
    properties?: Record<string, any> | null;
    sampleDataset?: SampleDatasetName | null;
  } | null;
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

export const buildDataSourceSettingsUrl = (
  selector = resolveClientRuntimeScopeSelector(),
) => buildRuntimeScopeUrl('/api/v1/settings/data-source', {}, selector);

export const buildSampleDatasetUrl = (
  selector = resolveClientRuntimeScopeSelector(),
) => buildRuntimeScopeUrl('/api/v1/settings/sample-dataset', {}, selector);

export const fetchSettings = async (
  selector: ClientRuntimeScopeSelector = resolveClientRuntimeScopeSelector(),
) => {
  const response = await fetch(buildSettingsUrl(selector));
  return parseRestJsonResponse<SettingsData>(
    response,
    '加载系统设置失败，请稍后重试。',
  );
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

export const updateDataSourceSettings = async (
  selector: ClientRuntimeScopeSelector,
  {
    properties,
    type,
  }: {
    properties: Record<string, any>;
    type?: DataSourceName | null;
  },
) => {
  const response = await fetch(buildDataSourceSettingsUrl(selector), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...(type ? { type } : {}),
      properties,
    }),
  });

  return parseRestJsonResponse<SettingsData['dataSource']>(
    response,
    '更新数据源失败，请稍后重试。',
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
