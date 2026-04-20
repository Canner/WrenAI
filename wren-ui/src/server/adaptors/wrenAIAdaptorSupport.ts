import axios from 'axios';
import {
  AskCandidateType,
  AskDetailResult,
  AskFeedbackResult,
  AskFeedbackStatus,
  AskHistory,
  AskResult,
  AskResultStatus,
  AskRuntimeIdentity,
  AskSkillCandidate,
  ChartAdjustmentInput,
  ChartInput,
  ChartResult,
  ChartStatus,
  InstructionStatus,
  QuestionsStatus,
  RecommendationQuestionsResult,
  SqlPairStatus,
  TextBasedAnswerResult,
  TextBasedAnswerStatus,
  WrenAISystemStatus,
} from '@server/models/adaptor';
import * as Errors from '@server/utils/error';
import { ThreadResponse } from '@server/repositories';

export interface WrenAIAdaptorLogger {
  debug(message: string): void;
  info?(message: string): void;
}

export interface WrenAIEndpointDeps {
  wrenAIBaseEndpoint: string;
  logger: WrenAIAdaptorLogger;
}

export interface WrenAITransformedError {
  code: Errors.GeneralErrorCodes;
  message: string;
  shortMessage: string;
}

export interface WrenAITransformedStatusResult {
  status:
    | AskResultStatus
    | TextBasedAnswerStatus
    | ChartStatus
    | SqlPairStatus
    | QuestionsStatus
    | InstructionStatus
    | AskFeedbackStatus;
  error?: WrenAITransformedError | null;
}

export const getAIServiceError = (error: any) => {
  const { data } = error.response || {};
  return data?.detail
    ? `${error.message}, detail: ${data.detail}`
    : error.message;
};

export const transformAskFeedbackResult = (body: any): AskFeedbackResult => {
  const { status, error } = transformStatusAndError(body);
  return {
    status: status as AskFeedbackStatus,
    error: error || undefined,
    response:
      body.response?.map((result: any) => ({
        sql: result.sql,
        type: result.type?.toUpperCase() as AskCandidateType,
      })) || [],
    traceId: body.trace_id,
    invalidSql: body.invalid_sql,
  };
};

export const transformChartAdjustmentInput = (input: ChartAdjustmentInput) => {
  const { query, sql, adjustmentOption, chartSchema, configurations } = input;
  return {
    query,
    sql,
    adjustment_option: {
      chart_type: adjustmentOption.chartType.toLowerCase(),
      x_axis: adjustmentOption.xAxis,
      y_axis: adjustmentOption.yAxis,
      x_offset: adjustmentOption.xOffset,
      color: adjustmentOption.color,
      theta: adjustmentOption.theta,
    },
    chart_schema: chartSchema,
    runtime_scope_id: input.runtimeScopeId,
    runtime_identity: transformRuntimeIdentity(input.runtimeIdentity),
    configurations,
  };
};

export const transformChartInput = (input: ChartInput) => ({
  query: input.query,
  sql: input.sql,
  data: input.data,
  runtime_scope_id: input.runtimeScopeId,
  runtime_identity: transformRuntimeIdentity(input.runtimeIdentity),
  configurations: input.configurations,
});

export const transformChartResult = (body: any): ChartResult => {
  const { status, error } = transformStatusAndError(body);
  return {
    status: status as ChartStatus,
    error: error || undefined,
    response: {
      reasoning: body.response?.reasoning,
      chartType: body.response?.chart_type,
      chartSchema: body.response?.chart_schema,
    },
  };
};

export const transformTextBasedAnswerResult = (
  body: any,
): TextBasedAnswerResult => {
  const { status, error } = transformStatusAndError(body);
  return {
    status: status as TextBasedAnswerStatus,
    numRowsUsedInLLM: body.num_rows_used_in_llm,
    error: error || undefined,
  };
};

export const waitDeployFinished = async ({
  deployId,
  ...deps
}: WrenAIEndpointDeps & {
  deployId: string;
}): Promise<boolean> => {
  let deploySuccess = false;
  for (let waitTime = 1; waitTime <= 7; waitTime++) {
    const status = await getDeployStatus({ ...deps, deployId });
    deps.logger.debug(`Wren AI: Deploy status: ${status}`);
    if (status === WrenAISystemStatus.FINISHED) {
      deploySuccess = true;
      break;
    }
    if (status === WrenAISystemStatus.FAILED) {
      break;
    }
    if (status !== WrenAISystemStatus.INDEXING) {
      deps.logger.debug(`Wren AI: Unknown Wren AI deploy status: ${status}`);
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, waitTime * 1000));
  }
  return deploySuccess;
};

export const getDeployStatus = async ({
  deployId,
  wrenAIBaseEndpoint,
  logger,
}: WrenAIEndpointDeps & {
  deployId: string;
}): Promise<WrenAISystemStatus> => {
  try {
    const res = await axios.get(
      `${wrenAIBaseEndpoint}/v1/semantics-preparations/${deployId}/status`,
    );
    if (res.data.error) {
      throw new Error(formatSemanticsPreparationError(res.data.error));
    }
    return res.data?.status.toUpperCase() as WrenAISystemStatus;
  } catch (err: any) {
    logger.debug(
      `Got error in API /v1/semantics-preparations/${deployId}/status: ${err.message}`,
    );
    throw err;
  }
};

export const transformAskResult = (body: any): AskResult => {
  const { status, error } = transformStatusAndError(body);
  const candidates = (body?.response || []).map((candidate: any) => ({
    type: candidate?.type?.toUpperCase() as AskCandidateType,
    sql: candidate.sql,
    viewId: candidate?.viewId ? Number(candidate.viewId) : null,
    sqlpairId: candidate?.sqlpairId ? Number(candidate.sqlpairId) : null,
  }));

  return {
    type: body?.type,
    status: status as AskResultStatus,
    error: error || null,
    response: candidates,
    rephrasedQuestion: body?.rephrased_question,
    intentReasoning: body?.intent_reasoning,
    sqlGenerationReasoning: body?.sql_generation_reasoning,
    retrievedTables: body?.retrieved_tables,
    askPath: body?.ask_path,
    shadowCompare: transformAskShadowCompare(body?.shadow_compare),
    invalidSql: body?.invalid_sql,
    traceId: body?.trace_id,
  };
};

export const formatSemanticsPreparationError = (error: unknown): string => {
  if (!error) {
    return 'Unknown semantics preparation error';
  }
  if (typeof error === 'string') {
    return error;
  }
  if (typeof error === 'object') {
    const message =
      'message' in error && typeof error.message === 'string'
        ? error.message
        : null;
    const code =
      'code' in error && typeof error.code === 'string' ? error.code : null;
    if (message && code) {
      return `${code}: ${message}`;
    }
    if (message) {
      return message;
    }
    if (code) {
      return code;
    }
    try {
      return JSON.stringify(error);
    } catch (_jsonError) {
      return String(error);
    }
  }
  return String(error);
};

export const transformAskShadowCompare = (body: any) => {
  if (!body) {
    return null;
  }

  return {
    enabled: Boolean(body?.enabled),
    executed: Boolean(body?.executed),
    comparable: Boolean(body?.comparable),
    primaryType: body?.primary_type || null,
    shadowType: body?.shadow_type || null,
    primaryAskPath: body?.primary_ask_path || null,
    shadowAskPath: body?.shadow_ask_path || null,
    primaryErrorType: body?.primary_error_type || null,
    shadowErrorType: body?.shadow_error_type || null,
    primarySql: body?.primary_sql || null,
    shadowSql: body?.shadow_sql || null,
    primaryResultCount:
      typeof body?.primary_result_count === 'number'
        ? body.primary_result_count
        : 0,
    shadowResultCount:
      typeof body?.shadow_result_count === 'number'
        ? body.shadow_result_count
        : 0,
    matched: Boolean(body?.matched),
    shadowError: body?.shadow_error || null,
    reason: body?.reason || null,
  };
};

export const transformRecommendationQuestionsResult = (
  body: any,
): RecommendationQuestionsResult => {
  const { status, error } = transformStatusAndError(body);
  return {
    ...body,
    status,
    error,
  };
};

export const transformAskDetailResult = (body: any): AskDetailResult => {
  const { type } = body;
  const { status, error } = transformStatusAndError(body);
  const steps = (body?.response?.steps || []).map((step: any) => ({
    summary: step.summary,
    sql: step.sql,
    cteName: step.cte_name,
  }));

  return {
    type,
    status: status as AskResultStatus,
    error: error || null,
    response: {
      description: body?.response?.description,
      steps,
    },
  };
};

export const transformStatusAndError = (
  body: any,
): WrenAITransformedStatusResult => {
  const status = body?.status?.toUpperCase();
  if (!status) {
    throw new Error(`Unknown ask status: ${body?.status}`);
  }

  const code = body?.error?.code;
  const isShowAIServiceErrorMessage =
    code === Errors.GeneralErrorCodes.NO_RELEVANT_SQL ||
    code === Errors.GeneralErrorCodes.AI_SERVICE_UNDEFINED_ERROR;

  const error = code
    ? Errors.create(
        code,
        isShowAIServiceErrorMessage
          ? {
              customMessage: body?.error?.message,
            }
          : undefined,
      )
    : null;

  const formattedError = error
    ? {
        code: error.extensions.code as Errors.GeneralErrorCodes,
        message: error.message,
        shortMessage: error.extensions.shortMessage as string,
      }
    : null;

  return {
    status,
    error: formattedError,
  };
};

export const transformHistoryInput = (
  histories?: Array<Pick<ThreadResponse, 'sql' | 'question'>>,
): AskHistory[] => {
  if (!histories) {
    return [];
  }

  return histories
    .filter(
      (
        history,
      ): history is Pick<ThreadResponse, 'sql' | 'question'> & {
        sql: string;
      } => typeof history.sql === 'string' && history.sql.length > 0,
    )
    .map((history) => ({
      sql: history.sql,
      question: history.question,
    }));
};

export const transformRuntimeIdentity = (
  runtimeIdentity?: AskRuntimeIdentity | null,
) => {
  if (!runtimeIdentity) {
    return undefined;
  }

  const hasCanonicalRuntimeFields =
    hasCanonicalRuntimeIdentity(runtimeIdentity);
  const hasAnyRuntimeFields = Boolean(
    runtimeIdentity.projectId || hasCanonicalRuntimeFields,
  );

  if (!hasAnyRuntimeFields) {
    return undefined;
  }

  const bridgeScopeId =
    !hasCanonicalRuntimeFields && runtimeIdentity.projectId !== undefined
      ? runtimeIdentity.projectId.toString()
      : undefined;

  return {
    bridgeScopeId,
    workspaceId: runtimeIdentity.workspaceId,
    knowledgeBaseId: runtimeIdentity.knowledgeBaseId,
    kbSnapshotId: runtimeIdentity.kbSnapshotId,
    deployHash: runtimeIdentity.deployHash,
    actorUserId: runtimeIdentity.actorUserId,
  };
};

export const requireRuntimeIdentity = (
  runtimeIdentity?: AskRuntimeIdentity | null,
): Record<string, any> => {
  const transformed = transformRuntimeIdentity(runtimeIdentity);
  if (!transformed) {
    throw new Error('Runtime identity is required');
  }
  return transformed;
};

export const hasCanonicalRuntimeIdentity = (
  runtimeIdentity: AskRuntimeIdentity,
) =>
  Boolean(
    runtimeIdentity.workspaceId ||
      runtimeIdentity.knowledgeBaseId ||
      runtimeIdentity.kbSnapshotId ||
      runtimeIdentity.deployHash ||
      runtimeIdentity.actorUserId,
  );

export const describeRuntimeIdentity = (runtimeIdentity: Record<string, any>) =>
  runtimeIdentity.deployHash ||
  runtimeIdentity.kbSnapshotId ||
  runtimeIdentity.knowledgeBaseId ||
  runtimeIdentity.workspaceId ||
  runtimeIdentity.actorUserId ||
  runtimeIdentity.bridgeScopeId ||
  'unknown';

export const transformSkills = (skills?: AskSkillCandidate[]) =>
  skills?.map((skill) => ({
    skillId: skill.skillId,
    skillName: skill.skillName,
    instruction: skill.instruction,
    executionMode: skill.executionMode,
  }));
