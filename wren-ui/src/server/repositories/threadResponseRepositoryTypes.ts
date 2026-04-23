import { AskResultStatus, ThinkingTrace } from '@server/models/adaptor';
import type {
  ResolvedHomeIntent,
  ResponseArtifactLineage,
} from '@/types/homeIntent';
import { IBasicRepository, IQueryOptions } from './baseRepository';

export interface DetailStep {
  summary: string;
  sql: string;
  cteName: string;
}

export interface ThreadResponseBreakdownDetail {
  queryId: string;
  status: string;
  error?: object;
  description?: string;
  steps?: Array<DetailStep>;
}

export interface ThreadResponseAnswerDetail {
  queryId?: string;
  status: string;
  error?: object;
  instructionCount?: number;
  numRowsUsedInLLM?: number;
  content?: string;
}

export interface ThreadResponseChartDetail {
  queryId?: string;
  status: string;
  error?: object;
  thinking?: ThinkingTrace | null;
  chartability?: {
    chartable: boolean;
    reasonCode?: string | null;
    message?: string | null;
  } | null;
  diagnostics?: {
    previewColumnCount?: number;
    previewRowCount?: number;
    previewColumns?: Array<{
      name: string;
      type?: string | null;
    }>;
    lastErrorCode?: string | null;
    lastErrorMessage?: string | null;
    submittedAt?: string | null;
    finalizedAt?: string | null;
  };
  description?: string;
  chartType?: string;
  chartSchema?: Record<string, any>;
  rawChartSchema?: Record<string, any>;
  canonicalizationVersion?: string;
  renderHints?: Record<string, any>;
  chartDataProfile?: Record<string, any>;
  validationErrors?: string[];
  adjustment?: boolean;
  retryCount?: number;
  nextRetryAt?: string | null;
  lastPolledAt?: string | null;
  lastError?: string | null;
  pollingLeaseOwner?: string | null;
  pollingLeaseExpiresAt?: string | null;
}

export enum ThreadResponseAdjustmentType {
  REASONING = 'REASONING',
  APPLY_SQL = 'APPLY_SQL',
}

export type ThreadResponseAdjustmentReasoningPayload = {
  originalThreadResponseId?: number;
  retrievedTables?: string[];
  sqlGenerationReasoning?: string;
};

export type ThreadResponseAdjustmentApplySqlPayload = {
  originalThreadResponseId?: number;
  sql?: string;
};

export interface ThreadResponseAdjustment {
  type: ThreadResponseAdjustmentType;
  payload: ThreadResponseAdjustmentReasoningPayload &
    ThreadResponseAdjustmentApplySqlPayload;
}

export interface ThreadResponse {
  id: number;
  askingTaskId?: number;
  viewId?: number;
  threadId: number;
  responseKind?: string | null;
  sourceResponseId?: number | null;
  resolvedIntent?: ResolvedHomeIntent | null;
  artifactLineage?: ResponseArtifactLineage | null;
  projectId?: number | null;
  workspaceId?: string | null;
  knowledgeBaseId?: string | null;
  kbSnapshotId?: string | null;
  deployHash?: string | null;
  actorUserId?: string | null;
  question: string;
  sql?: string;
  answerDetail?: ThreadResponseAnswerDetail;
  breakdownDetail?: ThreadResponseBreakdownDetail;
  chartDetail?: ThreadResponseChartDetail;
  adjustment?: ThreadResponseAdjustment;
}

export type ThreadResponseRuntimeScope = Pick<
  ThreadResponse,
  | 'projectId'
  | 'workspaceId'
  | 'knowledgeBaseId'
  | 'kbSnapshotId'
  | 'deployHash'
>;

export interface IThreadResponseRepository extends IBasicRepository<ThreadResponse> {
  getResponsesWithThread(
    threadId: number,
    limit?: number,
  ): Promise<ThreadResponse[]>;
  getResponsesWithThreadByScope(
    threadId: number,
    scope: ThreadResponseRuntimeScope,
    limit?: number,
  ): Promise<ThreadResponse[]>;
  findOneByIdWithRuntimeScope(
    id: number,
    scope: ThreadResponseRuntimeScope,
  ): Promise<ThreadResponse | null>;
  findUnfinishedBreakdownResponsesByWorkspaceId(
    workspaceId: string,
  ): Promise<ThreadResponse[]>;
  findUnfinishedBreakdownResponses(): Promise<ThreadResponse[]>;
  findUnfinishedAnswerResponses(): Promise<ThreadResponse[]>;
  findUnfinishedChartResponses(options?: {
    adjustment?: boolean;
  }): Promise<ThreadResponse[]>;
  claimChartPollingLease?: (
    id: number,
    scope: ThreadResponseRuntimeScope,
    workerId: string,
    leaseExpiresAt: string,
    queryOptions?: IQueryOptions,
  ) => Promise<ThreadResponse | null>;
  updateOneByIdWithRuntimeScope(
    id: number,
    scope: ThreadResponseRuntimeScope,
    data: Partial<{
      status: AskResultStatus;
      responseKind: string | null;
      sql: string;
      sourceResponseId: number | null;
      resolvedIntent: ResolvedHomeIntent | null;
      artifactLineage: ResponseArtifactLineage | null;
      viewId: number;
      answerDetail: ThreadResponseAnswerDetail;
      breakdownDetail: ThreadResponseBreakdownDetail;
      chartDetail: ThreadResponseChartDetail;
      adjustment: ThreadResponseAdjustment;
    }>,
    queryOptions?: IQueryOptions,
  ): Promise<ThreadResponse | null>;
}
