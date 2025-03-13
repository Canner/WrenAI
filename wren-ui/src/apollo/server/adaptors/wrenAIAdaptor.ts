import axios from 'axios';
import { Readable } from 'stream';
import {
  AskCandidateType,
  AskDetailInput,
  AskDetailResult,
  AskHistory,
  AskResult,
  AskResultStatus,
  AsyncQueryResponse,
  RecommendationQuestionsInput,
  RecommendationQuestionsResult,
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
} from '@server/models/adaptor';
import { getLogger } from '@server/utils';
import * as Errors from '@server/utils/error';
import { SqlPair } from '../repositories';
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
  deploySqlPair(
    projectId: number,
    sqlPair: { question: string; sql: string },
  ): Promise<AsyncQueryResponse>;
  getSqlPairResult(queryId: string): Promise<SqlPairResult>;
  deleteSqlPairs(projectId: number, sqlPairIds: number[]): Promise<void>;
  generateQuestions(input: QuestionInput): Promise<AsyncQueryResponse>;
  getQuestionsResult(queryId: string): Promise<Partial<QuestionsResult>>;
}

export class WrenAIAdaptor implements IWrenAIAdaptor {
  private readonly wrenAIBaseEndpoint: string;

  constructor({ wrenAIBaseEndpoint }: { wrenAIBaseEndpoint: string }) {
    this.wrenAIBaseEndpoint = wrenAIBaseEndpoint;
  }
  public async deploySqlPair(
    projectId: number,
    sqlPair: Partial<SqlPair>,
  ): Promise<AsyncQueryResponse> {
    try {
      const body = {
        sql_pairs: [
          {
            id: `${sqlPair.id}`,
            sql: sqlPair.sql,
            question: sqlPair.question,
          },
        ],
        project_id: projectId.toString(),
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
  public async deleteSqlPairs(
    projectId: number,
    sqlPairIds: number[],
  ): Promise<void> {
    try {
      await axios.delete(`${this.wrenAIBaseEndpoint}/v1/sql-pairs`, {
        data: {
          sql_pair_ids: sqlPairIds.map((id) => id.toString()),
          project_id: projectId.toString(),
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
        histories: this.transformHistoryInput(input.histories),
        configurations: input.configurations,
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
      const res = await axios.post(
        `${this.wrenAIBaseEndpoint}/v1/semantics-preparations`,
        {
          mdl: JSON.stringify(manifest),
          id: hash,
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
      const res = await axios.post(
        `${this.wrenAIBaseEndpoint}/v1/charts`,
        input,
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
        project_id: input.projectId.toString(),
        configuration: input.configurations,
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
      configurations,
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
    const { type, intent_reasoning } = body;
    const { status, error } = this.transformStatusAndError(body);
    const candidates = (body?.response || []).map((candidate: any) => ({
      type: candidate?.type?.toUpperCase() as AskCandidateType,
      sql: candidate.sql,
      viewId: candidate?.viewId ? Number(candidate.viewId) : null,
    }));

    return {
      type,
      status: status as AskResultStatus,
      error,
      response: candidates,
      intentReasoning: intent_reasoning,
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
      | QuestionsStatus;
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
    const error = code
      ? Errors.create(
          code,
          code === Errors.GeneralErrorCodes.AI_SERVICE_UNDEFINED_ERROR
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
}
