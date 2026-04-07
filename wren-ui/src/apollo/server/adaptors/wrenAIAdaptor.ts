import axios from 'axios';
import { Readable } from 'stream';
import {
  AskCandidateType,
  AskActorClaims,
  AskDetailInput,
  AskDetailResult,
  AskHistory,
  AskResult,
  AskResultStatus,
  AskRuntimeIdentity,
  AskSkillCandidate,
  AskSkillConnector,
  AskSkillSecret,
  AsyncQueryResponse,
  RecommendationQuestionsInput,
  RecommendationQuestionsResult,
  SkillExecutionResult,
  WrenAIDeployStatusEnum,
  WrenAISystemStatus,
  WrenAIDeployResponse,
  DeployData,
  AskInput,
  TextBasedAnswerInput,
  TextBasedAnswerResult,
  ChartInput,
  ChartAdjustmentInput,
  ChartResult,
  ChartStatus,
  TextBasedAnswerStatus,
  SqlPairResult,
  SqlPairStatus,
  QuestionInput,
  QuestionsResult,
  QuestionsStatus,
  InstructionStatus,
  InstructionResult,
  AskFeedbackInput,
  AskFeedbackResult,
  AskFeedbackStatus,
  DeleteSemanticsInput,
  DeploySqlPairInput,
  DeleteSqlPairsInput,
  GenerateInstructionsPayload,
  DeleteInstructionsInput,
} from '@server/models/adaptor';
import { getLogger } from '@server/utils';
import * as Errors from '@server/utils/error';
import { ThreadResponse } from '@server/repositories';

const logger = getLogger('WrenAIAdaptor');
logger.level = 'debug';

const getAIServiceError = (error: any) => {
  const { data } = error.response || {};
  return data?.detail
    ? `${error.message}, detail: ${data.detail}`
    : error.message;
};

export interface IWrenAIAdaptor {
  deploy(deployData: DeployData): Promise<WrenAIDeployResponse>;
  delete(input: DeleteSemanticsInput): Promise<void>;

  /**
   * Ask AI service a question.
   * AI service will return anwser candidates containing sql.
   * 1. use ask() to ask a question, AI service will return a queryId
   * 2. use getAskResult() to get the result of the queryId
   * 3. use cancelAsk() to cancel the query
   **/
  ask(input: AskInput): Promise<AsyncQueryResponse>;
  cancelAsk(queryId: string): Promise<void>;
  getAskResult(queryId: string): Promise<AskResult>;
  getAskStreamingResult(queryId: string): Promise<Readable>;

  /**
   * After you choose a candidate, you can request AI service to generate the detail.
   * 1. use generateAskDetail() to generate the detail. AI service will return a queryId
   * 2. use getAskDetailResult() to get the result of the queryId
   */
  generateAskDetail(input: AskDetailInput): Promise<AsyncQueryResponse>;
  getAskDetailResult(queryId: string): Promise<AskDetailResult>;

  /**
   * Generate recommendation questions
   */
  generateRecommendationQuestions(
    input: RecommendationQuestionsInput,
  ): Promise<AsyncQueryResponse>;
  getRecommendationQuestionsResult(
    queryId: string,
  ): Promise<RecommendationQuestionsResult>;

  /**
   * Get text-based answer from SQL
   */
  createTextBasedAnswer(
    input: TextBasedAnswerInput,
  ): Promise<AsyncQueryResponse>;
  getTextBasedAnswerResult(queryId: string): Promise<TextBasedAnswerResult>;
  streamTextBasedAnswer(queryId: string): Promise<Readable>;

  /**
   * Chart related APIs
   */
  generateChart(input: ChartInput): Promise<AsyncQueryResponse>;
  getChartResult(queryId: string): Promise<ChartResult>;
  cancelChart(queryId: string): Promise<void>;
  adjustChart(input: ChartAdjustmentInput): Promise<AsyncQueryResponse>;
  getChartAdjustmentResult(queryId: string): Promise<ChartResult>;
  cancelChartAdjustment(queryId: string): Promise<void>;

  /**
   * Sql Pair APIs
   */
  deploySqlPair(input: DeploySqlPairInput): Promise<AsyncQueryResponse>;
  getSqlPairResult(queryId: string): Promise<SqlPairResult>;
  deleteSqlPairs(input: DeleteSqlPairsInput): Promise<void>;
  generateQuestions(input: QuestionInput): Promise<AsyncQueryResponse>;
  getQuestionsResult(queryId: string): Promise<Partial<QuestionsResult>>;

  /**
   * instruction related APIs
   */
  generateInstruction(
    input: GenerateInstructionsPayload,
  ): Promise<AsyncQueryResponse>;
  getInstructionResult(queryId: string): Promise<InstructionResult>;
  deleteInstructions(input: DeleteInstructionsInput): Promise<void>;

  /**
   * Ask feedback APIs
   */
  createAskFeedback(input: AskFeedbackInput): Promise<AsyncQueryResponse>;
  getAskFeedbackResult(queryId: string): Promise<AskFeedbackResult>;
  cancelAskFeedback(queryId: string): Promise<void>;
}

export class WrenAIAdaptor implements IWrenAIAdaptor {
  private readonly wrenAIBaseEndpoint: string;

  constructor({ wrenAIBaseEndpoint }: { wrenAIBaseEndpoint: string }) {
    this.wrenAIBaseEndpoint = wrenAIBaseEndpoint;
  }

  public async delete(input: DeleteSemanticsInput): Promise<void> {
    try {
      const runtimeIdentity = this.requireRuntimeIdentity(
        input.runtimeIdentity,
      );
      const url = `${this.wrenAIBaseEndpoint}/v1/semantics`;
      const response = await axios.delete(url, {
        data: {
          runtime_identity: runtimeIdentity,
        },
      });

      if (response.status === 200) {
        logger.info(
          `Wren AI: Deleted semantics for runtime ${this.describeRuntimeIdentity(runtimeIdentity)}`,
        );
      } else {
        throw new Error(`Failed to delete semantics. ${response.data?.error}`);
      }
    } catch (error: any) {
      throw new Error(
        `Wren AI: Failed to delete semantics: ${getAIServiceError(error)}`,
      );
    }
  }

  public async deploySqlPair(
    input: DeploySqlPairInput,
  ): Promise<AsyncQueryResponse> {
    try {
      const runtimeIdentity = this.requireRuntimeIdentity(
        input.runtimeIdentity,
      );
      const body = {
        sql_pairs: [
          {
            id: `${input.sqlPair.id}`,
            sql: input.sqlPair.sql,
            question: input.sqlPair.question,
          },
        ],
        runtime_identity: runtimeIdentity,
      };

      return axios
        .post(`${this.wrenAIBaseEndpoint}/v1/sql-pairs`, body)
        .then((res) => {
          return { queryId: res.data.event_id };
        });
    } catch (err: any) {
      logger.debug(
        `Got error when deploying SQL pair: ${getAIServiceError(err)}`,
      );
      throw err;
    }
  }
  public async getSqlPairResult(queryId: string): Promise<SqlPairResult> {
    try {
      const res = await axios.get(
        `${this.wrenAIBaseEndpoint}/v1/sql-pairs/${queryId}`,
      );
      const { status, error } = this.transformStatusAndError(res.data);
      return {
        status: status as SqlPairStatus,
        error,
      };
    } catch (err: any) {
      logger.debug(
        `Got error when getting SQL pair result: ${getAIServiceError(err)}`,
      );
      throw err;
    }
  }
  public async deleteSqlPairs(input: DeleteSqlPairsInput): Promise<void> {
    try {
      const runtimeIdentity = this.requireRuntimeIdentity(
        input.runtimeIdentity,
      );
      await axios.delete(`${this.wrenAIBaseEndpoint}/v1/sql-pairs`, {
        data: {
          sql_pair_ids: input.sqlPairIds.map((id) => id.toString()),
          runtime_identity: runtimeIdentity,
        },
      });
      return;
    } catch (err: any) {
      logger.debug(
        `Got error when deleting SQL pair: ${getAIServiceError(err)}`,
      );
      throw err;
    }
  }

  /**
   * Ask AI service a question.
   * AI service will return anwser candidates containing sql.
   */

  public async ask(input: AskInput): Promise<AsyncQueryResponse> {
    try {
      const res = await axios.post(`${this.wrenAIBaseEndpoint}/v1/asks`, {
        query: input.query,
        id: input.deployId,
        runtime_scope_id: input.runtimeScopeId,
        histories: this.transformHistoryInput(input.histories),
        configurations: input.configurations,
        runtime_identity: this.transformRuntimeIdentity(input.runtimeIdentity),
        actor_claims: this.transformActorClaims(input.actorClaims),
        connectors: this.transformConnectors(input.connectors),
        secrets: this.transformSecrets(input.secrets),
        skill_config: input.skillConfig,
        skills: this.transformSkills(input.skills),
      });
      return { queryId: res.data.query_id };
    } catch (err: any) {
      logger.debug(`Got error when asking wren AI: ${getAIServiceError(err)}`);
      throw err;
    }
  }

  public async cancelAsk(queryId: string): Promise<void> {
    // make PATCH request /v1/asks/:query_id to cancel the query
    try {
      await axios.patch(`${this.wrenAIBaseEndpoint}/v1/asks/${queryId}`, {
        status: 'stopped',
      });
    } catch (err: any) {
      logger.debug(`Got error when canceling ask: ${getAIServiceError(err)}`);
      throw err;
    }
  }

  public async getAskResult(queryId: string): Promise<AskResult> {
    // make GET request /v1/asks/:query_id/result to get the result
    try {
      const res = await axios.get(
        `${this.wrenAIBaseEndpoint}/v1/asks/${queryId}/result`,
      );
      return this.transformAskResult(res.data);
    } catch (err: any) {
      logger.debug(
        `Got error when getting ask result: ${getAIServiceError(err)}`,
      );
      // throw err;
      throw Errors.create(Errors.GeneralErrorCodes.INTERNAL_SERVER_ERROR, {
        originalError: err,
      });
    }
  }

  public async getAskStreamingResult(queryId: string): Promise<Readable> {
    // make GET request /v1/asks/:query_id/streaming-result to get the streaming result
    try {
      const res = await axios.get(
        `${this.wrenAIBaseEndpoint}/v1/asks/${queryId}/streaming-result`,
        { responseType: 'stream' },
      );
      return res.data;
    } catch (err: any) {
      logger.debug(
        `Got error when getting ask streaming result: ${getAIServiceError(err)}`,
      );
      // throw err;
      throw Errors.create(Errors.GeneralErrorCodes.INTERNAL_SERVER_ERROR, {
        originalError: err,
      });
    }
  }

  /**
   * After you choose a candidate, you can request AI service to generate the detail.
   */

  public async generateAskDetail(
    input: AskDetailInput,
  ): Promise<AsyncQueryResponse> {
    try {
      const res = await axios.post(
        `${this.wrenAIBaseEndpoint}/v1/ask-details`,
        input,
      );
      return { queryId: res.data.query_id };
    } catch (err: any) {
      logger.debug(
        `Got error when generating ask detail: ${getAIServiceError(err)}`,
      );
      throw err;
    }
  }

  public async getAskDetailResult(queryId: string): Promise<AskDetailResult> {
    // make GET request /v1/ask-details/:query_id/result to get the result
    try {
      const res = await axios.get(
        `${this.wrenAIBaseEndpoint}/v1/ask-details/${queryId}/result`,
      );
      return this.transformAskDetailResult(res.data);
    } catch (err: any) {
      logger.debug(
        `Got error when getting ask detail result: ${getAIServiceError(err)}`,
      );
      throw err;
    }
  }

  public async deploy(deployData: DeployData): Promise<WrenAIDeployResponse> {
    const { manifest, hash } = deployData;
    try {
      const runtimeIdentity = this.requireRuntimeIdentity(
        deployData.runtimeIdentity,
      );
      const res = await axios.post(
        `${this.wrenAIBaseEndpoint}/v1/semantics-preparations`,
        {
          mdl: JSON.stringify(manifest),
          id: hash,
          runtime_identity: runtimeIdentity,
        },
      );
      const deployId = res.data.id;
      logger.debug(
        `Wren AI: Deploying wren AI, hash: ${hash}, deployId: ${deployId}`,
      );
      const deploySuccess = await this.waitDeployFinished(deployId);
      if (deploySuccess) {
        logger.debug(`Wren AI: Deploy wren AI success, hash: ${hash}`);
        return { status: WrenAIDeployStatusEnum.SUCCESS };
      } else {
        return {
          status: WrenAIDeployStatusEnum.FAILED,
          error: `Wren AI: Deploy wren AI failed or timeout, hash: ${hash}`,
        };
      }
    } catch (err: any) {
      logger.debug(
        `Got error when deploying to wren AI, hash: ${hash}. Error: ${err.message}`,
      );
      return {
        status: WrenAIDeployStatusEnum.FAILED,
        error: `Wren AI Error: deployment hash:${hash}, ${err.message}`,
      };
    }
  }

  public async generateRecommendationQuestions(
    input: RecommendationQuestionsInput,
  ): Promise<AsyncQueryResponse> {
    const body = {
      mdl: JSON.stringify(input.manifest),
      runtime_scope_id: input.runtimeScopeId,
      runtime_identity: this.transformRuntimeIdentity(input.runtimeIdentity),
      previous_questions: input.previousQuestions,
      max_questions: input.maxQuestions,
      max_categories: input.maxCategories,
      configuration: input.configuration,
    };
    logger.info(`Wren AI: Generating recommendation questions`);
    try {
      const res = await axios.post(
        `${this.wrenAIBaseEndpoint}/v1/question-recommendations`,
        body,
      );
      logger.info(
        `Wren AI: Generating recommendation questions, queryId: ${res.data.id}`,
      );
      return { queryId: res.data.id };
    } catch (err: any) {
      logger.debug(
        `Got error when generating recommendation questions: ${getAIServiceError(err)}`,
      );
      throw err;
    }
  }

  public async getRecommendationQuestionsResult(
    queryId: string,
  ): Promise<RecommendationQuestionsResult> {
    try {
      const res = await axios.get(
        `${this.wrenAIBaseEndpoint}/v1/question-recommendations/${queryId}`,
      );
      return this.transformRecommendationQuestionsResult(res.data);
    } catch (err: any) {
      logger.debug(
        `Got error when getting recommendation questions result: ${getAIServiceError(err)}`,
      );
      throw err;
    }
  }

  public async createTextBasedAnswer(
    input: TextBasedAnswerInput,
  ): Promise<AsyncQueryResponse> {
    const body = {
      query: input.query,
      sql: input.sql,
      sql_data: input.sqlData,
      thread_id: input.threadId,
      user_id: input.userId,
      configurations: input.configurations,
    };
    // make POST request /v1/sql-answers to create text-based answer
    try {
      const res = await axios.post(
        `${this.wrenAIBaseEndpoint}/v1/sql-answers`,
        body,
      );
      return { queryId: res.data.query_id };
    } catch (err: any) {
      logger.debug(
        `Got error when creating text-based answer: ${getAIServiceError(err)}`,
      );
      throw err;
    }
  }

  public async getTextBasedAnswerResult(
    queryId: string,
  ): Promise<TextBasedAnswerResult> {
    // make GET request /v1/sql-answers/:query_id to get the result
    try {
      const res = await axios.get(
        `${this.wrenAIBaseEndpoint}/v1/sql-answers/${queryId}`,
      );
      return this.transformTextBasedAnswerResult(res.data);
    } catch (err: any) {
      logger.debug(
        `Got error when getting text-based answer result: ${getAIServiceError(err)}`,
      );
      throw err;
    }
  }

  public async streamTextBasedAnswer(queryId: string): Promise<Readable> {
    // make GET request /v1/sql-answers/:query_id/streaming to get the streaming result
    try {
      const res = await axios.get(
        `${this.wrenAIBaseEndpoint}/v1/sql-answers/${queryId}/streaming`,
        { responseType: 'stream' },
      );
      return res.data;
    } catch (err: any) {
      logger.debug(
        `Got error when getting text-based answer streaming result: ${getAIServiceError(err)}`,
      );
      throw err;
    }
  }

  public async generateChart(input: ChartInput): Promise<AsyncQueryResponse> {
    try {
      const chartInput = this.transformChartInput(input);
      const res = await axios.post(
        `${this.wrenAIBaseEndpoint}/v1/charts`,
        chartInput,
      );
      return { queryId: res.data.query_id };
    } catch (err: any) {
      logger.debug(`Got error when creating chart: ${getAIServiceError(err)}`);
      throw err;
    }
  }

  public async getChartResult(queryId: string): Promise<ChartResult> {
    try {
      const res = await axios.get(
        `${this.wrenAIBaseEndpoint}/v1/charts/${queryId}`,
      );
      return this.transformChartResult(res.data);
    } catch (err: any) {
      logger.debug(
        `Got error when getting chart result: ${getAIServiceError(err)}`,
      );
      throw err;
    }
  }

  public async cancelChart(queryId: string): Promise<void> {
    try {
      await axios.patch(`${this.wrenAIBaseEndpoint}/v1/charts/${queryId}`, {
        status: 'stopped',
      });
    } catch (err: any) {
      logger.debug(`Got error when canceling chart: ${getAIServiceError(err)}`);
      throw err;
    }
  }

  public async adjustChart(
    input: ChartAdjustmentInput,
  ): Promise<AsyncQueryResponse> {
    try {
      const res = await axios.post(
        `${this.wrenAIBaseEndpoint}/v1/chart-adjustments`,
        this.transformChartAdjustmentInput(input),
      );
      return { queryId: res.data.query_id };
    } catch (err: any) {
      logger.debug(`Got error when adjusting chart: ${getAIServiceError(err)}`);
      throw err;
    }
  }

  public async getChartAdjustmentResult(queryId: string): Promise<ChartResult> {
    try {
      const res = await axios.get(
        `${this.wrenAIBaseEndpoint}/v1/chart-adjustments/${queryId}`,
      );
      return this.transformChartResult(res.data);
    } catch (err: any) {
      logger.debug(
        `Got error when getting chart adjustment result: ${getAIServiceError(err)}`,
      );
      throw err;
    }
  }

  public async cancelChartAdjustment(queryId: string): Promise<void> {
    try {
      await axios.patch(
        `${this.wrenAIBaseEndpoint}/v1/chart-adjustments/${queryId}`,
        {
          status: 'stopped',
        },
      );
    } catch (err: any) {
      logger.debug(
        `Got error when canceling chart adjustment: ${getAIServiceError(err)}`,
      );
      throw err;
    }
  }
  public async generateQuestions(
    input: QuestionInput,
  ): Promise<AsyncQueryResponse> {
    try {
      const body = {
        sqls: input.sqls,
        configurations: input.configurations,
        runtime_identity: this.transformRuntimeIdentity(input.runtimeIdentity),
      };

      const res = await axios.post(
        `${this.wrenAIBaseEndpoint}/v1/sql-questions`,
        body,
      );
      return { queryId: res.data.query_id };
    } catch (err: any) {
      logger.debug(
        `Got error when generating questions: ${getAIServiceError(err)}`,
      );
      throw err;
    }
  }

  public async generateInstruction(
    input: GenerateInstructionsPayload,
  ): Promise<AsyncQueryResponse> {
    const runtimeIdentity = this.requireRuntimeIdentity(input.runtimeIdentity);
    const body = {
      instructions: input.instructions.map((item) => ({
        id: item.id.toString(),
        instruction: item.instruction,
        questions: item.questions,
        is_default: item.isDefault,
      })),
      runtime_identity: runtimeIdentity,
    };
    try {
      const res = await axios.post(
        `${this.wrenAIBaseEndpoint}/v1/instructions`,
        body,
      );
      return { queryId: res.data.event_id };
    } catch (err: any) {
      logger.debug(
        `Got error when generating instruction: ${getAIServiceError(err)}`,
      );
      throw err;
    }
  }

  public async getQuestionsResult(
    queryId: string,
  ): Promise<Partial<QuestionsResult>> {
    try {
      const res = await axios.get(
        `${this.wrenAIBaseEndpoint}/v1/sql-questions/${queryId}`,
      );
      const { status, error } = this.transformStatusAndError(res.data);
      return {
        status: status as QuestionsStatus,
        error,
        questions: res.data.questions || [],
      };
    } catch (err: any) {
      logger.debug(
        `Got error when getting questions result: ${getAIServiceError(err)}`,
      );
      throw err;
    }
  }

  public async getInstructionResult(
    queryId: string,
  ): Promise<InstructionResult> {
    try {
      const res = await axios.get(
        `${this.wrenAIBaseEndpoint}/v1/instructions/${queryId}`,
      );
      return this.transformStatusAndError(res.data) as InstructionResult;
    } catch (err: any) {
      logger.debug(
        `Got error when getting instruction result: ${getAIServiceError(err)}`,
      );
      throw err;
    }
  }

  public async deleteInstructions(
    input: DeleteInstructionsInput,
  ): Promise<void> {
    try {
      const runtimeIdentity = this.requireRuntimeIdentity(
        input.runtimeIdentity,
      );
      await axios.delete(`${this.wrenAIBaseEndpoint}/v1/instructions`, {
        data: {
          instruction_ids: input.ids.map((id) => id.toString()),
          runtime_identity: runtimeIdentity,
        },
      });
    } catch (err: any) {
      logger.debug(
        `Got error when deleting instruction: ${getAIServiceError(err)}`,
      );
      throw err;
    }
  }

  public async createAskFeedback(
    input: AskFeedbackInput,
  ): Promise<AsyncQueryResponse> {
    try {
      const runtimeIdentity = this.requireRuntimeIdentity(
        input.runtimeIdentity,
      );
      const body = {
        question: input.question,
        tables: input.tables,
        sql_generation_reasoning: input.sqlGenerationReasoning,
        sql: input.sql,
        runtime_identity: runtimeIdentity,
        configurations: input.configurations,
      };
      const res = await axios.post(
        `${this.wrenAIBaseEndpoint}/v1/ask-feedbacks`,
        body,
      );
      return { queryId: res.data.query_id };
    } catch (err: any) {
      logger.debug(
        `Got error when creating ask feedback: ${getAIServiceError(err)}`,
      );
      throw err;
    }
  }

  public async getAskFeedbackResult(
    queryId: string,
  ): Promise<AskFeedbackResult> {
    try {
      const res = await axios.get(
        `${this.wrenAIBaseEndpoint}/v1/ask-feedbacks/${queryId}`,
      );
      return this.transformAskFeedbackResult(res.data);
    } catch (err: any) {
      logger.debug(
        `Got error when getting ask feedback result: ${getAIServiceError(err)}`,
      );
      throw err;
    }
  }

  public async cancelAskFeedback(queryId: string): Promise<void> {
    try {
      await axios.patch(
        `${this.wrenAIBaseEndpoint}/v1/ask-feedbacks/${queryId}`,
        {
          status: 'stopped',
        },
      );
    } catch (err: any) {
      logger.debug(
        `Got error when canceling ask feedback: ${getAIServiceError(err)}`,
      );
      throw err;
    }
  }

  private transformAskFeedbackResult(body: any): AskFeedbackResult {
    const { status, error } = this.transformStatusAndError(body);
    return {
      status: status as AskFeedbackStatus,
      error,
      response:
        body.response?.map((result: any) => ({
          sql: result.sql,
          type: result.type?.toUpperCase() as AskCandidateType,
        })) || [],
      traceId: body.trace_id,
      invalidSql: body.invalid_sql,
    };
  }

  private transformChartAdjustmentInput(input: ChartAdjustmentInput) {
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
      runtime_identity: this.transformRuntimeIdentity(input.runtimeIdentity),
      configurations,
    };
  }

  private transformChartInput(input: ChartInput) {
    return {
      query: input.query,
      sql: input.sql,
      data: input.data,
      runtime_scope_id: input.runtimeScopeId,
      runtime_identity: this.transformRuntimeIdentity(input.runtimeIdentity),
      configurations: input.configurations,
    };
  }

  private transformChartResult(body: any): ChartResult {
    const { status, error } = this.transformStatusAndError(body);
    return {
      status: status as ChartStatus,
      error,
      response: {
        reasoning: body.response?.reasoning,
        chartType: body.response?.chart_type,
        chartSchema: body.response?.chart_schema,
      },
    };
  }

  private transformTextBasedAnswerResult(body: any): TextBasedAnswerResult {
    const { status, error } = this.transformStatusAndError(body);
    return {
      status: status as TextBasedAnswerStatus,
      numRowsUsedInLLM: body.num_rows_used_in_llm,
      error,
    };
  }

  private async waitDeployFinished(deployId: string): Promise<boolean> {
    let deploySuccess = false;
    // timeout after 30 seconds
    for (let waitTime = 1; waitTime <= 7; waitTime++) {
      try {
        const status = await this.getDeployStatus(deployId);
        logger.debug(`Wren AI: Deploy status: ${status}`);
        if (status === WrenAISystemStatus.FINISHED) {
          deploySuccess = true;
          break;
        } else if (status === WrenAISystemStatus.FAILED) {
          break;
        } else if (status === WrenAISystemStatus.INDEXING) {
          // do nothing
        } else {
          logger.debug(`Wren AI: Unknown Wren AI deploy status: ${status}`);
          return;
        }
      } catch (err: any) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, waitTime * 1000));
    }
    return deploySuccess;
  }

  private async getDeployStatus(deployId: string): Promise<WrenAISystemStatus> {
    try {
      const res = await axios.get(
        `${this.wrenAIBaseEndpoint}/v1/semantics-preparations/${deployId}/status`,
      );
      if (res.data.error) {
        // passing AI response error string to catch block
        throw new Error(res.data.error);
      }
      return res.data?.status.toUpperCase() as WrenAISystemStatus;
    } catch (err: any) {
      logger.debug(
        `Got error in API /v1/semantics-preparations/${deployId}/status: ${err.message}`,
      );
      throw err;
    }
  }

  private transformAskResult(body: any): AskResult {
    const { status, error } = this.transformStatusAndError(body);
    const candidates = (body?.response || []).map((candidate: any) => ({
      type: candidate?.type?.toUpperCase() as AskCandidateType,
      sql: candidate.sql,
      viewId: candidate?.viewId ? Number(candidate.viewId) : null,
      sqlpairId: candidate?.sqlpairId ? Number(candidate.sqlpairId) : null,
    }));

    return {
      type: body?.type,
      status: status as AskResultStatus,
      error,
      response: candidates,
      rephrasedQuestion: body?.rephrased_question,
      intentReasoning: body?.intent_reasoning,
      sqlGenerationReasoning: body?.sql_generation_reasoning,
      retrievedTables: body?.retrieved_tables,
      skillResult: this.transformSkillResult(body?.skill_result),
      askPath: body?.ask_path,
      shadowCompare: this.transformAskShadowCompare(body?.shadow_compare),
      invalidSql: body?.invalid_sql,
      traceId: body?.trace_id,
    };
  }

  private transformAskShadowCompare(body: any) {
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
  }

  private transformSkillResult(body: any): SkillExecutionResult | null {
    if (!body) {
      return null;
    }

    return {
      resultType: body?.result_type,
      rows: body?.rows || [],
      columns: (body?.columns || []).map((column: any) => ({
        name: column?.name,
        type: column?.type,
        description: column?.description,
      })),
      series: body?.series || [],
      text: body?.text || null,
      chartSpec: body?.chart_spec || null,
      citations: (body?.citations || []).map((citation: any) => ({
        title: citation?.title,
        url: citation?.url,
        snippet: citation?.snippet,
        metadata: citation?.metadata || {},
      })),
      metadata: body?.metadata || {},
      trace: body?.trace
        ? {
            skillRunId: body.trace?.skill_run_id || null,
            runnerJobId: body.trace?.runner_job_id || null,
            traceId: body.trace?.trace_id || null,
            metadata: body.trace?.metadata || {},
          }
        : null,
    };
  }

  private transformRecommendationQuestionsResult(
    body: any,
  ): RecommendationQuestionsResult {
    const { status, error } = this.transformStatusAndError(body);
    return {
      ...body,
      status,
      error,
    };
  }

  private transformAskDetailResult(body: any): AskDetailResult {
    const { type } = body;
    const { status, error } = this.transformStatusAndError(body);

    // snake_case to camelCase
    const steps = (body?.response?.steps || []).map((step: any) => ({
      summary: step.summary,
      sql: step.sql,
      cteName: step.cte_name,
    }));

    return {
      type,
      status: status as AskResultStatus,
      error,
      response: {
        description: body?.response?.description,
        steps,
      },
    };
  }

  private transformStatusAndError(body: any): {
    status:
      | AskResultStatus
      | TextBasedAnswerStatus
      | ChartStatus
      | SqlPairStatus
      | QuestionsStatus
      | InstructionStatus
      | AskFeedbackStatus;
    error?: {
      code: Errors.GeneralErrorCodes;
      message: string;
      shortMessage: string;
    } | null;
  } {
    // transform status to enum
    const status = body?.status?.toUpperCase();

    if (!status) {
      throw new Error(`Unknown ask status: ${body?.status}`);
    }

    // use custom error to transform error
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

    // format custom error into WrenAIError that is used in graphql
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
  }

  private transformHistoryInput(histories: ThreadResponse[]): AskHistory[] {
    if (!histories) {
      return [];
    }

    // make it snake_case
    return histories.map((history) => ({
      sql: history.sql,
      question: history.question,
    }));
  }

  private transformRuntimeIdentity(
    runtimeIdentity?: AskRuntimeIdentity | null,
  ) {
    if (!runtimeIdentity) {
      return undefined;
    }

    const hasCanonicalRuntimeFields =
      this.hasCanonicalRuntimeIdentity(runtimeIdentity);
    const hasAnyRuntimeFields = Boolean(
      runtimeIdentity.projectId || hasCanonicalRuntimeFields,
    );

    if (!hasAnyRuntimeFields) {
      return undefined;
    }

    const projectBridgeId =
      !hasCanonicalRuntimeFields && runtimeIdentity.projectId !== undefined
        ? runtimeIdentity.projectId.toString()
        : undefined;

    return {
      projectBridgeId,
      workspaceId: runtimeIdentity.workspaceId,
      knowledgeBaseId: runtimeIdentity.knowledgeBaseId,
      kbSnapshotId: runtimeIdentity.kbSnapshotId,
      deployHash: runtimeIdentity.deployHash,
      actorUserId: runtimeIdentity.actorUserId,
    };
  }

  private requireRuntimeIdentity(
    runtimeIdentity?: AskRuntimeIdentity | null,
  ): Record<string, any> {
    const transformed = this.transformRuntimeIdentity(runtimeIdentity);
    if (!transformed) {
      throw new Error('Runtime identity is required');
    }
    return transformed;
  }

  private hasCanonicalRuntimeIdentity(runtimeIdentity: AskRuntimeIdentity) {
    return Boolean(
      runtimeIdentity.workspaceId ||
        runtimeIdentity.knowledgeBaseId ||
        runtimeIdentity.kbSnapshotId ||
        runtimeIdentity.deployHash ||
        runtimeIdentity.actorUserId,
    );
  }

  private describeRuntimeIdentity(runtimeIdentity: Record<string, any>) {
    return (
      runtimeIdentity.deployHash ||
      runtimeIdentity.kbSnapshotId ||
      runtimeIdentity.knowledgeBaseId ||
      runtimeIdentity.workspaceId ||
      runtimeIdentity.actorUserId ||
      runtimeIdentity.projectBridgeId ||
      runtimeIdentity.projectId ||
      'unknown'
    );
  }

  private transformActorClaims(actorClaims?: AskActorClaims) {
    if (!actorClaims) {
      return undefined;
    }

    return {
      userId: actorClaims.userId,
      workspaceMemberId: actorClaims.workspaceMemberId,
      roleKeys: actorClaims.roleKeys,
      permissionScopes: actorClaims.permissionScopes,
    };
  }

  private transformConnectors(connectors?: AskSkillConnector[]) {
    return connectors?.map((connector) => ({
      id: connector.id,
      type: connector.type,
      displayName: connector.displayName,
      config: connector.config,
      metadata: connector.metadata,
    }));
  }

  private transformSecrets(secrets?: AskSkillSecret[]) {
    return secrets?.map((secret) => ({
      id: secret.id,
      name: secret.name,
      values: secret.values,
      redactedKeys: secret.redactedKeys,
    }));
  }

  private transformSkills(skills?: AskSkillCandidate[]) {
    return skills?.map((skill) => ({
      skillId: skill.skillId,
      skillName: skill.skillName,
      runtimeKind: skill.runtimeKind,
      sourceType: skill.sourceType,
      sourceRef: skill.sourceRef,
      entrypoint: skill.entrypoint,
      skillConfig: skill.skillConfig,
      limits: skill.limits,
    }));
  }
}
