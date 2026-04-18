import {
  buildRuntimeScopeUrl,
  resolveClientRuntimeScopeSelector,
  type ClientRuntimeScopeSelector,
} from '@/runtime/client/runtimeScope';
import type { DiagramResponse } from '@/types/modeling';
import { parseRestJsonResponse } from './rest';

type TimedDiagramCacheEntry = {
  value: DiagramResponse;
  updatedAt: number;
};

const KNOWLEDGE_DIAGRAM_CACHE_TTL_MS = 20_000;
export const KNOWLEDGE_DIAGRAM_QUERY_FETCH_POLICY = 'no-cache' as const;
const diagramCacheByRequestUrl = new Map<string, TimedDiagramCacheEntry>();
const diagramRequestByRequestUrl = new Map<string, Promise<DiagramResponse>>();

const getFreshDiagramCache = (requestUrl: string) => {
  const cached = diagramCacheByRequestUrl.get(requestUrl);
  if (!cached) {
    return null;
  }

  if (Date.now() - cached.updatedAt > KNOWLEDGE_DIAGRAM_CACHE_TTL_MS) {
    diagramCacheByRequestUrl.delete(requestUrl);
    return null;
  }

  return cached.value;
};

export const clearKnowledgeDiagramRestCache = () => {
  diagramCacheByRequestUrl.clear();
  diagramRequestByRequestUrl.clear();
};

export const buildKnowledgeDiagramUrl = (
  selector = resolveClientRuntimeScopeSelector(),
) => buildRuntimeScopeUrl('/api/v1/knowledge/diagram', {}, selector);

export const peekKnowledgeDiagramPayload = ({
  selector,
  requestUrl,
}: {
  selector?: ClientRuntimeScopeSelector;
  requestUrl?: string;
}) => {
  const resolvedRequestUrl = requestUrl || buildKnowledgeDiagramUrl(selector);
  return getFreshDiagramCache(resolvedRequestUrl);
};

export const primeKnowledgeDiagramPayload = ({
  selector,
  requestUrl,
  payload,
}: {
  selector?: ClientRuntimeScopeSelector;
  requestUrl?: string;
  payload: DiagramResponse;
}) => {
  const resolvedRequestUrl = requestUrl || buildKnowledgeDiagramUrl(selector);
  diagramCacheByRequestUrl.set(resolvedRequestUrl, {
    value: payload,
    updatedAt: Date.now(),
  });
};

export const loadKnowledgeDiagramPayload = async ({
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
  const resolvedRequestUrl = requestUrl || buildKnowledgeDiagramUrl(selector);

  if (useCache) {
    const cachedPayload = getFreshDiagramCache(resolvedRequestUrl);
    if (cachedPayload) {
      return cachedPayload;
    }
  }

  const pendingRequest = diagramRequestByRequestUrl.get(resolvedRequestUrl);
  if (pendingRequest) {
    return pendingRequest;
  }

  const request = fetcher(resolvedRequestUrl)
    .then((response) =>
      parseRestJsonResponse<DiagramResponse['diagram']>(
        response,
        '加载知识库图谱失败，请稍后重试。',
      ),
    )
    .then((diagram) => {
      const payload = { diagram } as DiagramResponse;
      primeKnowledgeDiagramPayload({ requestUrl: resolvedRequestUrl, payload });
      return payload;
    })
    .finally(() => {
      diagramRequestByRequestUrl.delete(resolvedRequestUrl);
    });

  diagramRequestByRequestUrl.set(resolvedRequestUrl, request);
  return request;
};
