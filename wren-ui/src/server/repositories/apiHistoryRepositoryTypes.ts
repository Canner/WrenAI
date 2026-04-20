import { IBasicRepository } from './baseRepository';

export enum ApiType {
  GENERATE_SQL = 'GENERATE_SQL',
  RUN_SQL = 'RUN_SQL',
  GENERATE_VEGA_CHART = 'GENERATE_VEGA_CHART',
  GENERATE_SUMMARY = 'GENERATE_SUMMARY',
  ASK = 'ASK',
  GET_INSTRUCTIONS = 'GET_INSTRUCTIONS',
  CREATE_INSTRUCTION = 'CREATE_INSTRUCTION',
  UPDATE_INSTRUCTION = 'UPDATE_INSTRUCTION',
  DELETE_INSTRUCTION = 'DELETE_INSTRUCTION',
  GET_SQL_PAIRS = 'GET_SQL_PAIRS',
  CREATE_SQL_PAIR = 'CREATE_SQL_PAIR',
  UPDATE_SQL_PAIR = 'UPDATE_SQL_PAIR',
  DELETE_SQL_PAIR = 'DELETE_SQL_PAIR',
  GET_MODELS = 'GET_MODELS',
  GET_THREADS = 'GET_THREADS',
  GET_API_HISTORY = 'GET_API_HISTORY',
  UPDATE_THREAD = 'UPDATE_THREAD',
  DELETE_THREAD = 'DELETE_THREAD',
  CREATE_VIEW = 'CREATE_VIEW',
  DELETE_VIEW = 'DELETE_VIEW',
  PREVIEW_VIEW_DATA = 'PREVIEW_VIEW_DATA',
  PREVIEW_MODEL_DATA = 'PREVIEW_MODEL_DATA',
  GET_SKILLS = 'GET_SKILLS',
  CREATE_SKILL = 'CREATE_SKILL',
  UPDATE_SKILL = 'UPDATE_SKILL',
  DELETE_SKILL = 'DELETE_SKILL',
  GET_CONNECTORS = 'GET_CONNECTORS',
  CREATE_CONNECTOR = 'CREATE_CONNECTOR',
  UPDATE_CONNECTOR = 'UPDATE_CONNECTOR',
  DELETE_CONNECTOR = 'DELETE_CONNECTOR',
  TEST_CONNECTOR = 'TEST_CONNECTOR',
  REENCRYPT_SECRETS = 'REENCRYPT_SECRETS',
  GET_KNOWLEDGE_BASES = 'GET_KNOWLEDGE_BASES',
  CREATE_KNOWLEDGE_BASE = 'CREATE_KNOWLEDGE_BASE',
  UPDATE_KNOWLEDGE_BASE = 'UPDATE_KNOWLEDGE_BASE',
  STREAM_ASK = 'STREAM_ASK',
  STREAM_GENERATE_SQL = 'STREAM_GENERATE_SQL',
}

export interface ApiHistory {
  id?: string;
  projectId: number | null;
  workspaceId?: string | null;
  knowledgeBaseId?: string | null;
  kbSnapshotId?: string | null;
  deployHash?: string | null;
  actorUserId?: string | null;
  apiType: ApiType;
  threadId?: string;
  headers?: Record<string, string>;
  requestPayload?: Record<string, any>;
  responsePayload?: Record<string, any>;
  statusCode?: number;
  durationMs?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface PaginationOptions {
  offset: number;
  limit: number;
  orderBy?: Record<string, 'asc' | 'desc'>;
}

export interface AskShadowCompareBucket {
  key: string;
  count: number;
}

export interface AskShadowCompareTrendBucket {
  date: string;
  total: number;
  executed: number;
  comparable: number;
  matched: number;
  mismatched: number;
  errorCount: number;
}

export interface AskShadowCompareStats {
  total: number;
  withDiagnostics: number;
  enabled: number;
  executed: number;
  comparable: number;
  matched: number;
  mismatched: number;
  errorCount: number;
  byAskPath: AskShadowCompareBucket[];
  byShadowErrorType: AskShadowCompareBucket[];
  trends: AskShadowCompareTrendBucket[];
}

export type AskShadowCompareSummaryRow = {
  total?: unknown;
  with_diagnostics?: unknown;
  enabled?: unknown;
  executed?: unknown;
  comparable?: unknown;
  matched?: unknown;
  mismatched?: unknown;
  error_count?: unknown;
};

export type AskShadowCompareBucketRow = {
  key?: string | null;
  count?: unknown;
};

export type AskShadowCompareTrendBucketRow = {
  date?: unknown;
  total?: unknown;
  executed?: unknown;
  comparable?: unknown;
  matched?: unknown;
  mismatched?: unknown;
  error_count?: unknown;
};

export interface IApiHistoryRepository extends IBasicRepository<ApiHistory> {
  count(
    filter?: Partial<ApiHistory>,
    dateFilter?: { startDate?: Date; endDate?: Date },
  ): Promise<number>;
  findAllWithPagination(
    filter?: Partial<ApiHistory>,
    dateFilter?: { startDate?: Date; endDate?: Date },
    pagination?: PaginationOptions,
  ): Promise<ApiHistory[]>;
  getAskShadowCompareStats(
    filter?: Partial<ApiHistory>,
    dateFilter?: { startDate?: Date; endDate?: Date },
    apiTypes?: ApiType[],
  ): Promise<AskShadowCompareStats>;
}
