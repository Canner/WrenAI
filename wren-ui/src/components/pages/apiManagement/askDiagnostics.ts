import { ApiType } from '@/types/api';

export type AskShadowCompareDiagnostics = {
  enabled?: boolean;
  executed?: boolean;
  comparable?: boolean;
  matched?: boolean;
  primaryType?: string | null;
  shadowType?: string | null;
  primaryAskPath?: string | null;
  shadowAskPath?: string | null;
  primaryErrorType?: string | null;
  shadowErrorType?: string | null;
  primaryResultCount?: number | null;
  shadowResultCount?: number | null;
  reason?: string | null;
  shadowError?: string | null;
};

export type AskDiagnosticsPayload = {
  traceId?: string | null;
  askPath?: string | null;
  shadowCompare?: AskShadowCompareDiagnostics | null;
};

const isObjectRecord = (value: unknown): value is Record<string, any> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const isAskApiHistoryType = (apiType?: ApiType | null) =>
  apiType === ApiType.ASK || apiType === ApiType.STREAM_ASK;

export const getAskDiagnostics = (
  responsePayload?: Record<string, any> | null,
): AskDiagnosticsPayload | null => {
  const askDiagnostics = responsePayload?.askDiagnostics;

  if (!isObjectRecord(askDiagnostics)) {
    return null;
  }

  return askDiagnostics as AskDiagnosticsPayload;
};
