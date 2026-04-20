import axios from 'axios';
import {
  AskFeedbackInput,
  AsyncQueryResponse,
  DeleteInstructionsInput,
  DeleteSqlPairsInput,
  DeploySqlPairInput,
  GenerateInstructionsPayload,
  InstructionResult,
  QuestionInput,
  QuestionsResult,
  QuestionsStatus,
  SqlPairResult,
  SqlPairStatus,
} from '@server/models/adaptor';
import {
  getAIServiceError,
  requireRuntimeIdentity,
  transformAskFeedbackResult,
  transformStatusAndError,
  WrenAIEndpointDeps,
} from './wrenAIAdaptorSupport';

export const deploySqlPair = async (
  input: DeploySqlPairInput,
  { wrenAIBaseEndpoint, logger }: WrenAIEndpointDeps,
): Promise<AsyncQueryResponse> => {
  try {
    const body = {
      sql_pairs: [
        {
          id: `${input.sqlPair.id}`,
          sql: input.sqlPair.sql,
          question: input.sqlPair.question,
        },
      ],
      runtime_identity: requireRuntimeIdentity(input.runtimeIdentity),
    };

    const res = await axios.post(`${wrenAIBaseEndpoint}/v1/sql-pairs`, body);
    return { queryId: res.data.event_id };
  } catch (err: any) {
    logger.debug(
      `Got error when deploying SQL pair: ${getAIServiceError(err)}`,
    );
    throw err;
  }
};

export const getSqlPairResult = async (
  queryId: string,
  { wrenAIBaseEndpoint, logger }: WrenAIEndpointDeps,
): Promise<SqlPairResult> => {
  try {
    const res = await axios.get(
      `${wrenAIBaseEndpoint}/v1/sql-pairs/${queryId}`,
    );
    const { status, error } = transformStatusAndError(res.data);
    return {
      status: status as SqlPairStatus,
      error: error || undefined,
    };
  } catch (err: any) {
    logger.debug(
      `Got error when getting SQL pair result: ${getAIServiceError(err)}`,
    );
    throw err;
  }
};

export const deleteSqlPairs = async (
  input: DeleteSqlPairsInput,
  { wrenAIBaseEndpoint, logger }: WrenAIEndpointDeps,
): Promise<void> => {
  try {
    await axios.delete(`${wrenAIBaseEndpoint}/v1/sql-pairs`, {
      data: {
        sql_pair_ids: input.sqlPairIds.map((id) => id.toString()),
        runtime_identity: requireRuntimeIdentity(input.runtimeIdentity),
      },
    });
  } catch (err: any) {
    logger.debug(`Got error when deleting SQL pair: ${getAIServiceError(err)}`);
    throw err;
  }
};

export const generateQuestions = async (
  input: QuestionInput,
  { wrenAIBaseEndpoint, logger }: WrenAIEndpointDeps,
): Promise<AsyncQueryResponse> => {
  try {
    const body = {
      sqls: input.sqls,
      configurations: input.configurations,
      runtime_identity: transformRuntimeIdentityForOptional(
        input.runtimeIdentity,
      ),
    };

    const res = await axios.post(
      `${wrenAIBaseEndpoint}/v1/sql-questions`,
      body,
    );
    return { queryId: res.data.query_id };
  } catch (err: any) {
    logger.debug(
      `Got error when generating questions: ${getAIServiceError(err)}`,
    );
    throw err;
  }
};

export const generateInstruction = async (
  input: GenerateInstructionsPayload,
  { wrenAIBaseEndpoint, logger }: WrenAIEndpointDeps,
): Promise<AsyncQueryResponse> => {
  try {
    const body = {
      instructions: input.instructions.map((item) => ({
        id: item.id.toString(),
        instruction: item.instruction,
        questions: item.questions,
        is_default: item.isDefault,
      })),
      runtime_identity: requireRuntimeIdentity(input.runtimeIdentity),
    };
    const res = await axios.post(`${wrenAIBaseEndpoint}/v1/instructions`, body);
    return { queryId: res.data.event_id };
  } catch (err: any) {
    logger.debug(
      `Got error when generating instruction: ${getAIServiceError(err)}`,
    );
    throw err;
  }
};

export const getQuestionsResult = async (
  queryId: string,
  { wrenAIBaseEndpoint, logger }: WrenAIEndpointDeps,
): Promise<Partial<QuestionsResult>> => {
  try {
    const res = await axios.get(
      `${wrenAIBaseEndpoint}/v1/sql-questions/${queryId}`,
    );
    const { status, error } = transformStatusAndError(res.data);
    return {
      status: status as QuestionsStatus,
      error: error || undefined,
      questions: res.data.questions || [],
    };
  } catch (err: any) {
    logger.debug(
      `Got error when getting questions result: ${getAIServiceError(err)}`,
    );
    throw err;
  }
};

export const getInstructionResult = async (
  queryId: string,
  { wrenAIBaseEndpoint, logger }: WrenAIEndpointDeps,
): Promise<InstructionResult> => {
  try {
    const res = await axios.get(
      `${wrenAIBaseEndpoint}/v1/instructions/${queryId}`,
    );
    return transformStatusAndError(res.data) as InstructionResult;
  } catch (err: any) {
    logger.debug(
      `Got error when getting instruction result: ${getAIServiceError(err)}`,
    );
    throw err;
  }
};

export const deleteInstructions = async (
  input: DeleteInstructionsInput,
  { wrenAIBaseEndpoint, logger }: WrenAIEndpointDeps,
): Promise<void> => {
  try {
    await axios.delete(`${wrenAIBaseEndpoint}/v1/instructions`, {
      data: {
        instruction_ids: input.ids.map((id) => id.toString()),
        runtime_identity: requireRuntimeIdentity(input.runtimeIdentity),
      },
    });
  } catch (err: any) {
    logger.debug(
      `Got error when deleting instruction: ${getAIServiceError(err)}`,
    );
    throw err;
  }
};

export const createAskFeedback = async (
  input: AskFeedbackInput,
  { wrenAIBaseEndpoint, logger }: WrenAIEndpointDeps,
): Promise<AsyncQueryResponse> => {
  try {
    const body = {
      question: input.question,
      tables: input.tables,
      sql_generation_reasoning: input.sqlGenerationReasoning,
      sql: input.sql,
      runtime_scope_id: input.runtimeScopeId,
      runtime_identity: requireRuntimeIdentity(input.runtimeIdentity),
      configurations: input.configurations,
    };
    const res = await axios.post(
      `${wrenAIBaseEndpoint}/v1/ask-feedbacks`,
      body,
    );
    return { queryId: res.data.query_id };
  } catch (err: any) {
    logger.debug(
      `Got error when creating ask feedback: ${getAIServiceError(err)}`,
    );
    throw err;
  }
};

export const getAskFeedbackResult = async (
  queryId: string,
  { wrenAIBaseEndpoint, logger }: WrenAIEndpointDeps,
) => {
  try {
    const res = await axios.get(
      `${wrenAIBaseEndpoint}/v1/ask-feedbacks/${queryId}`,
    );
    return transformAskFeedbackResult(res.data);
  } catch (err: any) {
    logger.debug(
      `Got error when getting ask feedback result: ${getAIServiceError(err)}`,
    );
    throw err;
  }
};

export const cancelAskFeedback = async (
  queryId: string,
  { wrenAIBaseEndpoint, logger }: WrenAIEndpointDeps,
): Promise<void> => {
  try {
    await axios.patch(`${wrenAIBaseEndpoint}/v1/ask-feedbacks/${queryId}`, {
      status: 'stopped',
    });
  } catch (err: any) {
    logger.debug(
      `Got error when canceling ask feedback: ${getAIServiceError(err)}`,
    );
    throw err;
  }
};

const transformRuntimeIdentityForOptional = (runtimeIdentity: any) => {
  if (!runtimeIdentity) {
    return undefined;
  }

  const hasCanonicalRuntimeFields = Boolean(
    runtimeIdentity.workspaceId ||
    runtimeIdentity.knowledgeBaseId ||
    runtimeIdentity.kbSnapshotId ||
    runtimeIdentity.deployHash ||
    runtimeIdentity.actorUserId,
  );
  const hasAnyRuntimeFields = Boolean(
    runtimeIdentity.projectId || hasCanonicalRuntimeFields,
  );

  if (!hasAnyRuntimeFields) {
    return undefined;
  }

  return {
    bridgeScopeId:
      !hasCanonicalRuntimeFields && runtimeIdentity.projectId !== undefined
        ? runtimeIdentity.projectId.toString()
        : undefined,
    workspaceId: runtimeIdentity.workspaceId,
    knowledgeBaseId: runtimeIdentity.knowledgeBaseId,
    kbSnapshotId: runtimeIdentity.kbSnapshotId,
    deployHash: runtimeIdentity.deployHash,
    actorUserId: runtimeIdentity.actorUserId,
  };
};
