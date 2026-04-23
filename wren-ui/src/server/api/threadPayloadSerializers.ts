import {
  AskResultStatus,
  AskResultType,
  type ThinkingStep,
  type ThinkingTrace,
} from '@server/models/adaptor';
import type { PersistedRuntimeIdentity } from '@server/context/runtimeScope';
import type {
  ThreadResponse as RepositoryThreadResponse,
  Thread,
} from '@server/repositories';
import type { View } from '@server/repositories/viewRepository';
import { ThreadResponseAnswerStatus } from '@server/services/askingServiceShared';
import { deriveChartThinkingTrace } from '@server/services/chartThinking';
import {
  resolveResponseArtifactLineage,
  resolveResponseHomeIntent,
} from '@/features/home/thread/homeIntentContract';
import type { TrackedAskingResult } from '@/server/services/askingTaskTracker';
import type { TrackedAdjustmentResult } from '@/server/backgrounds/adjustmentBackgroundTracker';
import { safeFormatSQL } from '@server/utils/sqlFormat';

const constructCteSql = (
  steps: Array<{ cteName: string; summary: string; sql: string }>,
  stepIndex?: number,
) => {
  if (
    stepIndex !== undefined &&
    stepIndex !== null &&
    (stepIndex < 0 || stepIndex >= steps.length)
  ) {
    throw new Error(`Invalid stepIndex: ${stepIndex}`);
  }

  const slicedSteps =
    stepIndex === undefined || stepIndex === null
      ? steps
      : steps.slice(0, stepIndex + 1);

  if (slicedSteps.length === 1) {
    return `-- ${slicedSteps[0].summary}\n${slicedSteps[0].sql}`;
  }

  let sql = 'WITH ';
  slicedSteps.forEach((step, index) => {
    if (index === slicedSteps.length - 1) {
      sql += `\n-- ${step.summary}\n`;
      sql += `${step.sql}`;
    } else if (index === slicedSteps.length - 2) {
      sql += `${step.cteName} AS`;
      sql += `\n-- ${step.summary}\n`;
      sql += `(${step.sql})`;
    } else {
      sql += `${step.cteName} AS`;
      sql += `\n-- ${step.summary}\n`;
      sql += `(${step.sql}),`;
    }
  });

  return sql;
};

type ViewShape = {
  id: number;
  name: string;
  statement: string;
  displayName: string;
};

type SqlPairShape = {
  id: number;
  question: string;
  sql: string;
};

type ResponseSerializationServices = {
  askingService: {
    getAskingTaskById(id: number): Promise<TrackedAskingResult | null>;
    getAdjustmentTaskById(id: number): Promise<TrackedAdjustmentResult | null>;
  };
  modelService?: {
    getViewByRuntimeIdentity(
      runtimeIdentity: PersistedRuntimeIdentity,
      viewId: number,
    ): Promise<View | null>;
  };
  sqlPairService?: {
    getSqlPair(
      runtimeIdentity: PersistedRuntimeIdentity,
      sqlPairId: number,
    ): Promise<{
      id: number;
      question: string;
      sql: string;
    } | null>;
  };
};

const toDisplayName = (view: View) => {
  if (!view.properties) {
    return view.name;
  }

  try {
    return JSON.parse(view.properties)?.displayName || view.name;
  } catch {
    return view.name;
  }
};

const toViewShape = (view: View | null): ViewShape | null => {
  if (!view) {
    return null;
  }

  return {
    id: view.id,
    name: view.name,
    statement: view.statement,
    displayName: toDisplayName(view),
  };
};

const toSqlPairShape = (
  sqlPair:
    | {
        id: number;
        question: string;
        sql: string;
      }
    | null
    | undefined,
): SqlPairShape | null => {
  if (!sqlPair) {
    return null;
  }

  return {
    id: sqlPair.id,
    question: sqlPair.question,
    sql: safeFormatSQL(sqlPair.sql),
  };
};

const toFormattedAnswerDetail = (
  answerDetail: RepositoryThreadResponse['answerDetail'],
) => {
  if (!answerDetail) {
    return null;
  }

  const { content, ...rest } = answerDetail;
  if (!content) {
    return answerDetail;
  }

  return {
    ...rest,
    content: content.replace(/\\n/g, '\n').replace(/\\"/g, '"'),
  };
};

const toFormattedSql = (response: RepositoryThreadResponse) => {
  if (response.breakdownDetail?.steps?.length) {
    return safeFormatSQL(constructCteSql(response.breakdownDetail.steps));
  }

  return response.sql ? safeFormatSQL(response.sql) : null;
};

const buildThinkingStep = ({
  key,
  status,
  messageParams,
  phase,
  detail,
  errorCode,
  tags,
}: {
  key: string;
  status: ThinkingStep['status'];
  messageParams?: ThinkingStep['messageParams'];
  phase?: string | null;
  detail?: string | null;
  errorCode?: string | null;
  tags?: string[] | null;
}): ThinkingStep => ({
  key,
  status,
  messageKey: key,
  ...(messageParams ? { messageParams } : {}),
  ...(phase ? { phase } : {}),
  ...(detail ? { detail } : {}),
  ...(errorCode ? { errorCode } : {}),
  ...(tags?.length ? { tags } : {}),
});

const buildThinkingTrace = (steps: ThinkingStep[]): ThinkingTrace => ({
  steps,
  currentStepKey:
    steps.find((step) => step.status === 'running')?.key ||
    steps.find((step) => step.status === 'failed')?.key ||
    null,
});

const buildAskAnswerThinkingTail = ({
  answerStatus,
  answerRows,
  answerInstructionCount,
}: {
  answerStatus?: RepositoryThreadResponse['answerDetail'] extends infer T
    ? T extends { status?: infer S }
      ? S | null
      : null
    : null;
  answerRows: number;
  answerInstructionCount?: number | null;
}): ThinkingStep[] => {
  const answerFailed =
    answerStatus === ThreadResponseAnswerStatus.FAILED ||
    answerStatus === ThreadResponseAnswerStatus.INTERRUPTED;

  const dataStatus: ThinkingStep['status'] = [
    ThreadResponseAnswerStatus.NOT_STARTED,
    ThreadResponseAnswerStatus.PREPROCESSING,
    ThreadResponseAnswerStatus.FETCHING_DATA,
  ].includes(answerStatus as ThreadResponseAnswerStatus)
    ? 'running'
    : [
          ThreadResponseAnswerStatus.STREAMING,
          ThreadResponseAnswerStatus.FINISHED,
        ].includes(answerStatus as ThreadResponseAnswerStatus)
      ? 'finished'
      : answerFailed
        ? 'failed'
        : 'pending';

  const answerGenerationStatus: ThinkingStep['status'] =
    answerStatus === ThreadResponseAnswerStatus.STREAMING
      ? 'running'
      : answerStatus === ThreadResponseAnswerStatus.FINISHED
        ? 'finished'
        : answerFailed
          ? 'failed'
          : 'pending';

  const answerInstructionsStatus: ThinkingStep['status'] =
    typeof answerInstructionCount === 'number' ||
    [
      ThreadResponseAnswerStatus.PREPROCESSING,
      ThreadResponseAnswerStatus.STREAMING,
      ThreadResponseAnswerStatus.FINISHED,
      ThreadResponseAnswerStatus.FAILED,
      ThreadResponseAnswerStatus.INTERRUPTED,
    ].includes(answerStatus as ThreadResponseAnswerStatus)
      ? 'finished'
      : dataStatus === 'finished'
        ? 'running'
        : 'pending';

  return [
    buildThinkingStep({
      key: 'ask.data_fetched',
      status: dataStatus,
      messageParams: {
        rows: answerRows || 0,
      },
      phase: 'data',
    }),
    buildThinkingStep({
      key: 'ask.answer_instructions_retrieved',
      status: answerInstructionsStatus,
      messageParams: {
        count: answerInstructionCount ?? 0,
      },
      phase: 'answer',
    }),
    buildThinkingStep({
      key: 'ask.answer_generated',
      status: answerGenerationStatus,
      phase: 'answer',
    }),
  ];
};

const buildAskThinking = ({
  askingTask,
  response,
}: {
  askingTask: TrackedAskingResult | null;
  response: RepositoryThreadResponse;
}): ThinkingTrace | null => {
  if (!askingTask) {
    return null;
  }

  if (response.viewId) {
    return buildThinkingTrace([
      buildThinkingStep({
        key: 'ask.view_reused',
        status: 'finished',
      }),
    ]);
  }

  if (askingTask.response?.[0]?.sqlpairId) {
    return buildThinkingTrace([
      buildThinkingStep({
        key: 'ask.sql_pair_reused',
        status: 'finished',
      }),
    ]);
  }

  if (response.sql && askingTask.invalidSql) {
    return buildThinkingTrace([
      buildThinkingStep({
        key: 'ask.sql_corrected',
        status: 'finished',
      }),
    ]);
  }

  const reasoning = askingTask.sqlGenerationReasoning || '';
  const tables = (askingTask.retrievedTables || []).filter(Boolean);
  const answerStatus = response.answerDetail?.status || null;
  const answerRows = response.answerDetail?.numRowsUsedInLLM || 0;
  const answerInstructionCount = response.answerDetail?.instructionCount;
  const usesSqlFlow =
    askingTask.type === AskResultType.TEXT_TO_SQL ||
    Boolean(response.sql) ||
    tables.length > 0;

  if (!usesSqlFlow) {
    const understandingStatus: ThinkingStep['status'] =
      askingTask.status === AskResultStatus.UNDERSTANDING
        ? 'running'
        : askingTask.status === AskResultStatus.FAILED && !reasoning
          ? 'failed'
          : [
                AskResultStatus.SEARCHING,
                AskResultStatus.PLANNING,
                AskResultStatus.GENERATING,
                AskResultStatus.CORRECTING,
                AskResultStatus.FINISHED,
                AskResultStatus.STOPPED,
              ].includes(askingTask.status)
            ? 'finished'
            : 'pending';

    const reasoningStatus: ThinkingStep['status'] =
      askingTask.status === AskResultStatus.PLANNING
        ? 'running'
        : [
              AskResultStatus.GENERATING,
              AskResultStatus.CORRECTING,
              AskResultStatus.FINISHED,
              AskResultStatus.STOPPED,
            ].includes(askingTask.status)
          ? 'finished'
          : askingTask.status === AskResultStatus.FAILED && Boolean(reasoning)
            ? 'failed'
            : 'pending';

    const generateStatus: ThinkingStep['status'] = [
      AskResultStatus.GENERATING,
      AskResultStatus.CORRECTING,
    ].includes(askingTask.status)
      ? 'running'
      : [AskResultStatus.FINISHED, AskResultStatus.STOPPED].includes(
            askingTask.status,
          )
        ? 'finished'
        : askingTask.status === AskResultStatus.FAILED
          ? 'failed'
          : 'pending';

    return buildThinkingTrace([
      buildThinkingStep({
        key: 'ask.question_understood',
        status: understandingStatus,
      }),
      buildThinkingStep({
        key: 'ask.answer_reasoned',
        status: reasoningStatus,
        detail: reasoning || null,
      }),
      buildThinkingStep({
        key: 'ask.answer_generated',
        status: generateStatus,
      }),
    ]);
  }

  if (askingTask.thinking?.steps?.length) {
    const answerTail = buildAskAnswerThinkingTail({
      answerStatus,
      answerRows,
      answerInstructionCount,
    }).filter(
      (step) =>
        !askingTask.thinking?.steps.some(
          (existing) => existing.key === step.key,
        ),
    );

    return buildThinkingTrace([...askingTask.thinking.steps, ...answerTail]);
  }

  const isProcessingReasoning = askingTask.status === AskResultStatus.PLANNING;
  const isProcessingSql = [
    AskResultStatus.GENERATING,
    AskResultStatus.CORRECTING,
  ].includes(askingTask.status);
  const sqlFailed = askingTask.status === AskResultStatus.FAILED;

  const intentStatus: ThinkingStep['status'] =
    askingTask.status === AskResultStatus.UNDERSTANDING
      ? 'running'
      : sqlFailed && tables.length === 0 && !reasoning && !response.sql
        ? 'failed'
        : askingTask.status
          ? 'finished'
          : 'pending';

  const modelStatus: ThinkingStep['status'] =
    askingTask.status === AskResultStatus.SEARCHING
      ? 'running'
      : tables.length > 0
        ? 'finished'
        : sqlFailed && !reasoning && !response.sql
          ? 'failed'
          : [
                AskResultStatus.PLANNING,
                AskResultStatus.GENERATING,
                AskResultStatus.CORRECTING,
                AskResultStatus.FINISHED,
                AskResultStatus.STOPPED,
              ].includes(askingTask.status)
            ? 'finished'
            : 'pending';

  const reasoningStatus: ThinkingStep['status'] = isProcessingReasoning
    ? 'running'
    : reasoning
      ? 'finished'
      : sqlFailed
        ? 'failed'
        : [
              AskResultStatus.GENERATING,
              AskResultStatus.CORRECTING,
              AskResultStatus.FINISHED,
              AskResultStatus.STOPPED,
            ].includes(askingTask.status)
          ? 'finished'
          : 'pending';

  const sqlStatus: ThinkingStep['status'] = isProcessingSql
    ? 'running'
    : response.sql
      ? 'finished'
      : sqlFailed
        ? 'failed'
        : askingTask.status === AskResultStatus.FINISHED
          ? 'finished'
          : 'pending';

  const [dataStep, answerInstructionsStep, answerStep] =
    buildAskAnswerThinkingTail({
      answerInstructionCount,
      answerStatus,
      answerRows,
    });

  return buildThinkingTrace([
    buildThinkingStep({
      key: 'ask.intent_recognized',
      status: intentStatus,
      phase: 'intent',
    }),
    buildThinkingStep({
      key: 'ask.candidate_models_selected',
      status: modelStatus,
      messageParams: { count: tables.length },
      phase: 'retrieval',
      tags: tables.slice(0, 6),
    }),
    buildThinkingStep({
      key: 'ask.sql_reasoned',
      status: reasoningStatus,
      phase: 'reasoning',
      detail: reasoning || null,
    }),
    buildThinkingStep({
      key: 'ask.sql_generated',
      status: sqlStatus,
      messageParams: {
        correcting: askingTask.status === AskResultStatus.CORRECTING,
      },
      phase: 'generation',
    }),
    dataStep,
    answerInstructionsStep,
    answerStep,
  ]);
};

const buildChartThinking = (
  chartDetail: RepositoryThreadResponse['chartDetail'],
): ThinkingTrace | null =>
  chartDetail?.thinking?.steps?.length
    ? chartDetail.thinking
    : deriveChartThinkingTrace(chartDetail);

const toAskingTaskShape = async ({
  askingTask,
  runtimeIdentity,
  services,
}: {
  askingTask: TrackedAskingResult | null;
  runtimeIdentity: PersistedRuntimeIdentity;
  services: ResponseSerializationServices;
}) => {
  if (!askingTask) {
    return null;
  }

  const candidates = await Promise.all(
    (askingTask.response || []).map(async (candidate: any) => {
      const view = candidate.viewId
        ? await services.modelService?.getViewByRuntimeIdentity(
            runtimeIdentity,
            candidate.viewId,
          )
        : null;
      const sqlPair = candidate.sqlpairId
        ? await services.sqlPairService?.getSqlPair(
            runtimeIdentity,
            candidate.sqlpairId,
          )
        : null;

      return {
        type: candidate.type,
        sql: candidate.sql ? safeFormatSQL(candidate.sql) : '',
        view: toViewShape(view || null),
        sqlPair: toSqlPairShape(sqlPair),
      };
    }),
  );

  return {
    type:
      askingTask.status === AskResultStatus.STOPPED && !askingTask.type
        ? AskResultType.TEXT_TO_SQL
        : askingTask.type,
    status: askingTask.status,
    error: askingTask.error || null,
    candidates,
    queryId: askingTask.queryId,
    rephrasedQuestion: askingTask.rephrasedQuestion,
    intentReasoning: askingTask.intentReasoning,
    sqlGenerationReasoning: askingTask.sqlGenerationReasoning,
    retrievedTables: askingTask.retrievedTables,
    invalidSql: askingTask.invalidSql
      ? safeFormatSQL(askingTask.invalidSql)
      : undefined,
    traceId: askingTask.traceId,
  };
};

const toAdjustmentTaskShape = (
  adjustmentTask: TrackedAdjustmentResult | null,
) => {
  if (!adjustmentTask) {
    return null;
  }

  return {
    queryId: adjustmentTask.queryId || '',
    status: adjustmentTask.status,
    error: adjustmentTask.error || null,
    sql: adjustmentTask.response?.[0]?.sql
      ? safeFormatSQL(adjustmentTask.response[0].sql)
      : '',
    traceId: adjustmentTask.traceId || '',
    invalidSql: adjustmentTask.invalidSql
      ? safeFormatSQL(adjustmentTask.invalidSql)
      : undefined,
  };
};

export const serializeThreadResponsePayload = async ({
  response,
  runtimeIdentity,
  services,
}: {
  response: RepositoryThreadResponse;
  runtimeIdentity: PersistedRuntimeIdentity;
  services: ResponseSerializationServices;
}) => {
  const view = response.viewId
    ? await services.modelService?.getViewByRuntimeIdentity(
        runtimeIdentity,
        response.viewId,
      )
    : null;
  const askingTask =
    !response.adjustment && response.askingTaskId
      ? await services.askingService.getAskingTaskById(response.askingTaskId)
      : null;
  const adjustmentTask =
    response.adjustment && response.askingTaskId
      ? await services.askingService.getAdjustmentTaskById(
          response.askingTaskId,
        )
      : null;
  const askingTaskShape = await toAskingTaskShape({
    askingTask,
    runtimeIdentity,
    services,
  });
  const answerDetail = toFormattedAnswerDetail(response.answerDetail);
  const chartDetail = response.chartDetail
    ? {
        ...response.chartDetail,
        thinking: buildChartThinking(response.chartDetail),
      }
    : null;
  const shouldRefreshResolvedIntent =
    Boolean(askingTaskShape?.type) &&
    response.responseKind !== 'CHART_FOLLOWUP' &&
    response.resolvedIntent?.source !== 'classifier';
  const derivedResolvedIntent = resolveResponseHomeIntent({
    id: response.id,
    threadId: response.threadId,
    responseKind: response.responseKind ?? null,
    sourceResponseId: response.sourceResponseId ?? null,
    sql: response.sql ?? null,
    askingTask: askingTaskShape
      ? {
          type: askingTaskShape.type ?? null,
        }
      : null,
    answerDetail: response.answerDetail ?? null,
    breakdownDetail: response.breakdownDetail ?? null,
    chartDetail,
    resolvedIntent: null,
  });
  const baseResolvedIntent = resolveResponseHomeIntent({
    id: response.id,
    threadId: response.threadId,
    responseKind: response.responseKind ?? null,
    sourceResponseId: response.sourceResponseId ?? null,
    sql: response.sql ?? null,
    askingTask: askingTaskShape
      ? {
          type: askingTaskShape.type ?? null,
        }
      : null,
    answerDetail: response.answerDetail ?? null,
    breakdownDetail: response.breakdownDetail ?? null,
    chartDetail,
    resolvedIntent: shouldRefreshResolvedIntent
      ? null
      : (response.resolvedIntent ?? null),
  });
  const resolvedIntent = baseResolvedIntent
    ? {
        ...baseResolvedIntent,
        kind: derivedResolvedIntent?.kind ?? baseResolvedIntent.kind,
        mode: derivedResolvedIntent?.mode ?? baseResolvedIntent.mode,
        target: derivedResolvedIntent?.target ?? baseResolvedIntent.target,
        sourceThreadId:
          derivedResolvedIntent?.sourceThreadId ??
          baseResolvedIntent.sourceThreadId ??
          null,
        sourceResponseId:
          derivedResolvedIntent?.sourceResponseId ??
          baseResolvedIntent.sourceResponseId ??
          null,
        artifactPlan:
          derivedResolvedIntent?.artifactPlan ??
          baseResolvedIntent.artifactPlan ??
          null,
        conversationAidPlan:
          derivedResolvedIntent?.conversationAidPlan ??
          baseResolvedIntent.conversationAidPlan ??
          null,
      }
    : derivedResolvedIntent;
  const artifactLineage = resolveResponseArtifactLineage({
    responseKind: response.responseKind ?? null,
    sourceResponseId: response.sourceResponseId ?? null,
    resolvedIntent,
    artifactLineage: response.artifactLineage ?? null,
  });

  return {
    id: response.id,
    threadId: response.threadId,
    workspaceId: response.workspaceId ?? runtimeIdentity.workspaceId ?? null,
    knowledgeBaseId:
      response.knowledgeBaseId ?? runtimeIdentity.knowledgeBaseId ?? null,
    kbSnapshotId: response.kbSnapshotId ?? runtimeIdentity.kbSnapshotId ?? null,
    deployHash: response.deployHash ?? runtimeIdentity.deployHash ?? null,
    question: response.question,
    resolvedIntent,
    responseKind: response.responseKind ?? null,
    sql: toFormattedSql(response),
    sourceResponseId: response.sourceResponseId ?? null,
    artifactLineage,
    view: toViewShape(view || null),
    askingTask: askingTaskShape
      ? {
          ...askingTaskShape,
          thinking: buildAskThinking({ askingTask, response }),
        }
      : null,
    breakdownDetail: response.breakdownDetail ?? null,
    answerDetail,
    chartDetail,
    adjustment: response.adjustment ?? null,
    adjustmentTask: toAdjustmentTaskShape(adjustmentTask),
  };
};

export const serializeThreadDetailPayload = async ({
  thread,
  responses,
  runtimeIdentity,
  services,
}: {
  thread: Thread;
  responses: RepositoryThreadResponse[];
  runtimeIdentity: PersistedRuntimeIdentity;
  services: ResponseSerializationServices;
}) => ({
  id: thread.id,
  summary: thread.summary,
  workspaceId: thread.workspaceId ?? null,
  knowledgeBaseId: thread.knowledgeBaseId ?? null,
  kbSnapshotId: thread.kbSnapshotId ?? null,
  deployHash: thread.deployHash ?? null,
  knowledgeBaseIds: thread.knowledgeBaseIds ?? [],
  selectedSkillIds: thread.selectedSkillIds ?? [],
  responses: await Promise.all(
    (responses || []).map((response) =>
      serializeThreadResponsePayload({
        response,
        runtimeIdentity,
        services,
      }),
    ),
  ),
});
