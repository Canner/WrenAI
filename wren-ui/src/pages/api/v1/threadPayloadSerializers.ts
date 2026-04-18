import { AskResultStatus, AskResultType } from '@server/models/adaptor';
import type { PersistedRuntimeIdentity } from '@server/context/runtimeScope';
import type {
  ThreadResponse as RepositoryThreadResponse,
  Thread,
} from '@server/repositories';
import type { View } from '@server/repositories/viewRepository';
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

  return {
    id: response.id,
    threadId: response.threadId,
    question: response.question,
    sql: toFormattedSql(response),
    view: toViewShape(view || null),
    askingTask: await toAskingTaskShape({
      askingTask,
      runtimeIdentity,
      services,
    }),
    breakdownDetail: response.breakdownDetail ?? null,
    answerDetail: toFormattedAnswerDetail(response.answerDetail),
    chartDetail: response.chartDetail ?? null,
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
