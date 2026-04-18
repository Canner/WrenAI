import {
  buildRuntimeScopeUrl,
  type ClientRuntimeScopeSelector,
} from '@/runtime/client/runtimeScope';

type ErrorPayload = {
  error?: string;
};

type RunSqlColumn = {
  name: string;
  type: string;
};

type RunSqlResponse = {
  id?: string;
  columns: RunSqlColumn[];
  records?: Array<Record<string, any>>;
  threadId?: string;
  totalRows?: number;
};

export type SqlPreviewDataResponse = {
  columns: RunSqlColumn[];
  data: any[][];
  threadId?: string;
  totalRows?: number;
};

export type ValidateSqlResponse = {
  valid: boolean;
};

const buildRunSqlUrl = (selector?: ClientRuntimeScopeSelector) =>
  buildRuntimeScopeUrl('/api/v1/run_sql', {}, selector);

const buildError = (payload: ErrorPayload | null, fallback: string) =>
  new Error(payload?.error || fallback);

export const previewSql = async (
  selector: ClientRuntimeScopeSelector,
  sql: string,
  limit = 50,
) => {
  const response = await fetch(buildRunSqlUrl(selector), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, limit }),
  });
  const payload = (await response.json().catch(() => null)) as
    | RunSqlResponse
    | ErrorPayload
    | null;

  if (!response.ok) {
    throw buildError(
      payload as ErrorPayload | null,
      '预览 SQL 数据失败，请稍后重试',
    );
  }

  const previewPayload = payload as RunSqlResponse;
  const columns = previewPayload.columns || [];
  const records = previewPayload.records || [];

  return {
    columns,
    data: records.map((record) => columns.map((column) => record[column.name])),
    threadId: previewPayload.threadId,
    totalRows: previewPayload.totalRows,
  } as SqlPreviewDataResponse;
};

export const validateSql = async (
  selector: ClientRuntimeScopeSelector,
  sql: string,
) => {
  const response = await fetch(buildRunSqlUrl(selector), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, limit: 1, dryRun: true }),
  });
  const payload = (await response.json().catch(() => null)) as
    | ValidateSqlResponse
    | ErrorPayload
    | null;

  if (!response.ok) {
    throw buildError(payload as ErrorPayload | null, 'SQL 语法无效');
  }

  return payload as ValidateSqlResponse;
};
