import axios from 'axios';
import { Readable } from 'stream';
import {
  AskDetailInput,
  AskDetailResult,
  AskInput,
  AskResult,
  AsyncQueryResponse,
  ChartAdjustmentInput,
  ChartInput,
  ChartResult,
  DeleteSemanticsInput,
  DeployData,
  RecommendationQuestionsInput,
  RecommendationQuestionsResult,
  TextBasedAnswerInput,
  TextBasedAnswerResult,
  WrenAIDeployResponse,
  WrenAIDeployStatusEnum,
} from '@server/models/adaptor';
import { getLogger } from '@server/utils';
import * as Errors from '@server/utils/error';
import {
  cancelAskFeedback,
  createAskFeedback,
  deleteInstructions,
  deleteSqlPairs,
  deploySqlPair,
  generateInstruction,
  generateQuestions,
  getAskFeedbackResult,
  getInstructionResult,
  getQuestionsResult,
  getSqlPairResult,
} from './wrenAIAdaptorOperations';
import {
  describeRuntimeIdentity,
  getAIServiceError,
  requireRuntimeIdentity,
  transformAskDetailResult,
  transformAskResult,
  transformChartAdjustmentInput,
  transformChartInput,
  transformChartResult,
  transformHistoryInput,
  transformRecommendationQuestionsResult,
  transformRuntimeIdentity,
  transformSkills,
  transformTextBasedAnswerResult,
  waitDeployFinished,
} from './wrenAIAdaptorSupport';
import { IWrenAIAdaptor } from './wrenAIAdaptorTypes';

const logger = getLogger('WrenAIAdaptor');
logger.level = 'debug';

export type { IWrenAIAdaptor } from './wrenAIAdaptorTypes';

export class WrenAIAdaptor implements IWrenAIAdaptor {
  private readonly wrenAIBaseEndpoint: string;

  constructor({ wrenAIBaseEndpoint }: { wrenAIBaseEndpoint: string }) {
    this.wrenAIBaseEndpoint = wrenAIBaseEndpoint;
  }

  public async delete(input: DeleteSemanticsInput): Promise<void> {
    try {
      const runtimeIdentity = requireRuntimeIdentity(input.runtimeIdentity);
      const response = await axios.delete(
        `${this.wrenAIBaseEndpoint}/v1/semantics`,
        {
          data: {
            runtime_identity: runtimeIdentity,
          },
        },
      );

      if (response.status === 200) {
        logger.info?.(
          `Wren AI: Deleted semantics for runtime ${describeRuntimeIdentity(runtimeIdentity)}`,
        );
        return;
      }

      throw new Error(`Failed to delete semantics. ${response.data?.error}`);
    } catch (error: any) {
      throw new Error(
        `Wren AI: Failed to delete semantics: ${getAIServiceError(error)}`,
      );
    }
  }

  public async deploySqlPair(
    input: Parameters<IWrenAIAdaptor['deploySqlPair']>[0],
  ): Promise<AsyncQueryResponse> {
    return await deploySqlPair(input, this.getEndpointDeps());
  }

  public async getSqlPairResult(queryId: string) {
    return await getSqlPairResult(queryId, this.getEndpointDeps());
  }

  public async deleteSqlPairs(
    input: Parameters<IWrenAIAdaptor['deleteSqlPairs']>[0],
  ): Promise<void> {
    return await deleteSqlPairs(input, this.getEndpointDeps());
  }

  public async ask(input: AskInput): Promise<AsyncQueryResponse> {
    try {
      const res = await axios.post(`${this.wrenAIBaseEndpoint}/v1/asks`, {
        query: input.query,
        id: input.deployId,
        runtime_scope_id: input.runtimeScopeId,
        retrieval_scope_ids: input.retrievalScopeIds,
        histories: transformHistoryInput(input.histories),
        configurations: input.configurations,
        runtime_identity: transformRuntimeIdentity(input.runtimeIdentity),
        skills: transformSkills(input.skills),
      });
      return { queryId: res.data.query_id };
    } catch (err: any) {
      logger.debug(`Got error when asking wren AI: ${getAIServiceError(err)}`);
      throw err;
    }
  }

  public async cancelAsk(queryId: string): Promise<void> {
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
    try {
      const res = await axios.get(
        `${this.wrenAIBaseEndpoint}/v1/asks/${queryId}/result`,
      );
      return transformAskResult(res.data);
    } catch (err: any) {
      logger.debug(
        `Got error when getting ask result: ${getAIServiceError(err)}`,
      );
      throw Errors.create(Errors.GeneralErrorCodes.INTERNAL_SERVER_ERROR, {
        originalError: err,
      });
    }
  }

  public async getAskStreamingResult(queryId: string): Promise<Readable> {
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
      throw Errors.create(Errors.GeneralErrorCodes.INTERNAL_SERVER_ERROR, {
        originalError: err,
      });
    }
  }

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
    try {
      const res = await axios.get(
        `${this.wrenAIBaseEndpoint}/v1/ask-details/${queryId}/result`,
      );
      return transformAskDetailResult(res.data);
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
      const runtimeIdentity = requireRuntimeIdentity(
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
      const deploySuccess = await waitDeployFinished({
        ...this.getEndpointDeps(),
        deployId,
      });
      if (deploySuccess) {
        logger.debug(`Wren AI: Deploy wren AI success, hash: ${hash}`);
        return { status: WrenAIDeployStatusEnum.SUCCESS };
      }
      return {
        status: WrenAIDeployStatusEnum.FAILED,
        error: `Wren AI: Deploy wren AI failed or timeout, hash: ${hash}`,
      };
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
      runtime_identity: transformRuntimeIdentity(input.runtimeIdentity),
      previous_questions: input.previousQuestions,
      max_questions: input.maxQuestions,
      max_categories: input.maxCategories,
      configuration: input.configuration,
    };
    logger.info?.(`Wren AI: Generating recommendation questions`);
    try {
      const res = await axios.post(
        `${this.wrenAIBaseEndpoint}/v1/question-recommendations`,
        body,
      );
      logger.info?.(
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
      return transformRecommendationQuestionsResult(res.data);
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
    try {
      const res = await axios.post(
        `${this.wrenAIBaseEndpoint}/v1/sql-answers`,
        {
          query: input.query,
          sql: input.sql,
          sql_data: input.sqlData,
          thread_id: input.threadId,
          user_id: input.userId,
          runtime_scope_id: input.runtimeScopeId,
          runtime_identity: transformRuntimeIdentity(input.runtimeIdentity),
          configurations: input.configurations,
        },
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
    try {
      const res = await axios.get(
        `${this.wrenAIBaseEndpoint}/v1/sql-answers/${queryId}`,
      );
      return transformTextBasedAnswerResult(res.data);
    } catch (err: any) {
      logger.debug(
        `Got error when getting text-based answer result: ${getAIServiceError(err)}`,
      );
      throw err;
    }
  }

  public async streamTextBasedAnswer(queryId: string): Promise<Readable> {
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
        transformChartInput(input),
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
      return transformChartResult(res.data);
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
        transformChartAdjustmentInput(input),
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
      return transformChartResult(res.data);
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
        { status: 'stopped' },
      );
    } catch (err: any) {
      logger.debug(
        `Got error when canceling chart adjustment: ${getAIServiceError(err)}`,
      );
      throw err;
    }
  }

  public async generateQuestions(
    input: Parameters<IWrenAIAdaptor['generateQuestions']>[0],
  ) {
    return await generateQuestions(input, this.getEndpointDeps());
  }

  public async generateInstruction(
    input: Parameters<IWrenAIAdaptor['generateInstruction']>[0],
  ) {
    return await generateInstruction(input, this.getEndpointDeps());
  }

  public async getQuestionsResult(queryId: string) {
    return await getQuestionsResult(queryId, this.getEndpointDeps());
  }

  public async getInstructionResult(queryId: string) {
    return await getInstructionResult(queryId, this.getEndpointDeps());
  }

  public async deleteInstructions(
    input: Parameters<IWrenAIAdaptor['deleteInstructions']>[0],
  ): Promise<void> {
    return await deleteInstructions(input, this.getEndpointDeps());
  }

  public async createAskFeedback(
    input: Parameters<IWrenAIAdaptor['createAskFeedback']>[0],
  ) {
    return await createAskFeedback(input, this.getEndpointDeps());
  }

  public async getAskFeedbackResult(queryId: string) {
    return await getAskFeedbackResult(queryId, this.getEndpointDeps());
  }

  public async cancelAskFeedback(queryId: string): Promise<void> {
    return await cancelAskFeedback(queryId, this.getEndpointDeps());
  }

  private getEndpointDeps() {
    return {
      wrenAIBaseEndpoint: this.wrenAIBaseEndpoint,
      logger,
    };
  }
}
