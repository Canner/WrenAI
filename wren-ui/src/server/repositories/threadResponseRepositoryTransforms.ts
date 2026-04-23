import {
  camelCase,
  isPlainObject,
  mapKeys,
  mapValues,
  snakeCase,
} from 'lodash';
import type {
  ThreadResponse,
  ThreadResponseRuntimeScope,
} from './threadResponseRepositoryTypes';

export const THREAD_RESPONSE_JSONB_COLUMNS = [
  'answerDetail',
  'breakdownDetail',
  'chartDetail',
  'adjustment',
  'resolvedIntent',
  'artifactLineage',
];

export const hasCanonicalThreadResponseScope = (
  scope: ThreadResponseRuntimeScope,
) =>
  Boolean(
    scope.workspaceId ||
    scope.knowledgeBaseId ||
    scope.kbSnapshotId ||
    scope.deployHash,
  );

export const transformJoinedThreadResponses = (
  results: any[],
): ThreadResponse[] =>
  results
    .map((res) => mapKeys(res, (_, key) => camelCase(key)))
    .map((res) => ({
      ...res,
      answerDetail:
        res.answerDetail && typeof res.answerDetail === 'string'
          ? JSON.parse(res.answerDetail)
          : res.answerDetail || null,
      breakdownDetail:
        res.breakdownDetail && typeof res.breakdownDetail === 'string'
          ? JSON.parse(res.breakdownDetail)
          : res.breakdownDetail || null,
      chartDetail:
        res.chartDetail && typeof res.chartDetail === 'string'
          ? JSON.parse(res.chartDetail)
          : res.chartDetail || null,
      adjustment:
        res.adjustment && typeof res.adjustment === 'string'
          ? JSON.parse(res.adjustment)
          : res.adjustment || null,
    })) as ThreadResponse[];

export const transformThreadResponseToDBData = (data: any) => {
  if (!isPlainObject(data)) {
    throw new Error('Unexpected dbdata');
  }

  const transformedData = mapValues(data, (value, key) => {
    if (THREAD_RESPONSE_JSONB_COLUMNS.includes(key)) {
      return value === undefined ? value : JSON.stringify(value);
    }
    return value;
  });

  return mapKeys(transformedData, (_value, key) => snakeCase(key));
};

export const transformThreadResponseFromDBData = (
  data: any,
): ThreadResponse => {
  if (!isPlainObject(data)) {
    throw new Error('Unexpected dbdata');
  }

  const camelCaseData = mapKeys(data, (_value, key) => camelCase(key));
  return mapValues(camelCaseData, (value, key) => {
    if (THREAD_RESPONSE_JSONB_COLUMNS.includes(key)) {
      if (typeof value === 'string') {
        return value ? JSON.parse(value) : value;
      }
      return value;
    }
    return value;
  }) as ThreadResponse;
};

export const hydrateJoinedThreadResponseRuntimeScope = (
  data: any,
): ThreadResponse => {
  const transformed = transformThreadResponseFromDBData(
    data,
  ) as ThreadResponse & {
    threadProjectId?: number | null;
    threadWorkspaceId?: string | null;
    threadKnowledgeBaseId?: string | null;
    threadKbSnapshotId?: string | null;
    threadDeployHash?: string | null;
    threadActorUserId?: string | null;
  };

  const {
    threadProjectId,
    threadWorkspaceId,
    threadKnowledgeBaseId,
    threadKbSnapshotId,
    threadDeployHash,
    threadActorUserId,
    ...threadResponse
  } = transformed;

  return {
    ...threadResponse,
    projectId: threadResponse.projectId ?? threadProjectId ?? null,
    workspaceId: threadResponse.workspaceId ?? threadWorkspaceId ?? null,
    knowledgeBaseId:
      threadResponse.knowledgeBaseId ?? threadKnowledgeBaseId ?? null,
    kbSnapshotId: threadResponse.kbSnapshotId ?? threadKbSnapshotId ?? null,
    deployHash: threadResponse.deployHash ?? threadDeployHash ?? null,
    actorUserId: threadResponse.actorUserId ?? threadActorUserId ?? null,
  };
};
