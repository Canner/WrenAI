import axios from 'axios';
import { Manifest } from '@server/mdl/type';
import { getLogger } from '@server/utils';
import * as Errors from '@server/utils/error';

const logger = getLogger('WrenAIAdaptor');
logger.level = 'debug';

export interface WrenAIError {
  code: Errors.GeneralErrorCodes;
  message: string;
}

export enum WrenAIDeployStatusEnum {
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
}

export interface WrenAIDeployResponse {
  status: WrenAIDeployStatusEnum;
  error?: string;
}

enum WrenAISystemStatus {
  INDEXING = 'INDEXING',
  FINISHED = 'FINISHED',
  FAILED = 'FAILED',
}

export interface deployData {
  manifest: Manifest;
  hash: string;
}

// ask
export interface AskStep {
  summary: string;
  sql: string;
  cteName: string;
}

export interface AskHistory {
  sql: string;
  summary: string;
  steps: Array<AskStep>;
}

export interface AskInput {
  query: string;
  deployId: string;
  history?: AskHistory;
}

export interface AsyncQueryResponse {
  queryId: string;
}

export enum AskResultStatus {
  UNDERSTANDING = 'UNDERSTANDING',
  SEARCHING = 'SEARCHING',
  GENERATING = 'GENERATING',
  FINISHED = 'FINISHED',
  FAILED = 'FAILED',
  STOPPED = 'STOPPED',
}

export interface AskResponse<R, S> {
  status: S;
  response: R | null;
  error: WrenAIError | null;
}

export interface AskDetailInput {
  query: string;
  sql: string;
  summary: string;
}

export type AskDetailResult = AskResponse<
  {
    description: string;
    steps: AskStep[];
  },
  AskResultStatus
>;

export type AskResult = AskResponse<
  Array<{
    sql: string;
    summary: string;
  }>,
  AskResultStatus
>;

export interface IWrenAIAdaptor {
  deploy(deployData: deployData): Promise<WrenAIDeployResponse>;

  /**
   * Ask AI service a question.
   * AI service will return anwser candidates containing sql and summary.
   * 1. use ask() to ask a question, AI service will return a queryId
   * 2. use getAskResult() to get the result of the queryId
   * 3. use cancelAsk() to cancel the query
   **/
  ask(input: AskInput): Promise<AsyncQueryResponse>;
  cancelAsk(queryId: string): Promise<void>;
  getAskResult(queryId: string): Promise<AskResult>;

  /**
   * After you choose a candidate, you can request AI service to generate the detail.
   * 1. use generateAskDetail() to generate the detail. AI service will return a queryId
   * 2. use getAskDetailResult() to get the result of the queryId
   */
  generateAskDetail(input: AskDetailInput): Promise<AsyncQueryResponse>;
  getAskDetailResult(queryId: string): Promise<AskDetailResult>;
}

export class WrenAIAdaptor implements IWrenAIAdaptor {
  private readonly wrenAIBaseEndpoint: string;

  constructor({ wrenAIBaseEndpoint }: { wrenAIBaseEndpoint: string }) {
    this.wrenAIBaseEndpoint = wrenAIBaseEndpoint;
  }

  /**
   * Ask AI service a question.
   * AI service will return anwser candidates containing sql and summary.
   */

  public async ask(input: AskInput): Promise<AsyncQueryResponse> {
    try {
      const res = await axios.post(`${this.wrenAIBaseEndpoint}/v1/asks`, {
        query: input.query,
        id: input.deployId,
        history: this.transfromHistoryInput(input.history),
      });
      return { queryId: res.data.query_id };
    } catch (err: any) {
      logger.debug(`Got error when asking wren AI: ${err.message}`);
      throw err;
    }
  }

  public async cancelAsk(queryId: string): Promise<void> {
    // make PATCH request /v1/asks/:query_id to cancel the query
    try {
      await axios.patch(`${this.wrenAIBaseEndpoint}/v1/asks/${queryId}`);
    } catch (err: any) {
      logger.debug(`Got error when canceling ask: ${err.message}`);
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
      logger.debug(`Got error when getting ask result: ${err.message}`);
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
      logger.debug(`Got error when generating ask detail: ${err.message}`);
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
      logger.debug(`Got error when getting ask detail result: ${err.message}`);
      throw err;
    }
  }

  public async deploy(deployData: deployData): Promise<WrenAIDeployResponse> {
    const { manifest, hash } = deployData;
    try {
      const res = await axios.post(
        `${this.wrenAIBaseEndpoint}/v1/semantics-preparations`,
        { mdl: JSON.stringify(manifest), id: hash },
      );
      const deployId = res.data.id;
      logger.debug(
        `WrenAI: Deploying wren AI, hash: ${hash}, deployId: ${deployId}`,
      );
      const deploySuccess = await this.waitDeployFinished(deployId);
      if (deploySuccess) {
        logger.debug(`WrenAI: Deploy wren AI success, hash: ${hash}`);
        return { status: WrenAIDeployStatusEnum.SUCCESS };
      } else {
        return {
          status: WrenAIDeployStatusEnum.FAILED,
          error: `WrenAI: Deploy wren AI failed or timeout, hash: ${hash}`,
        };
      }
    } catch (err: any) {
      logger.debug(
        `Got error when deploying to wren AI, hash: ${hash}. Error: ${err.message}`,
      );
      return {
        status: WrenAIDeployStatusEnum.FAILED,
        error: `WrenAI Error: deployment hash:${hash}, ${err.message}`,
      };
    }
  }

  private async waitDeployFinished(deployId: string): Promise<boolean> {
    let deploySuccess = false;
    // timeout after 30 seconds
    for (let waitTime = 1; waitTime <= 7; waitTime++) {
      try {
        const status = await this.getDeployStatus(deployId);
        logger.debug(`WrenAI: Deploy status: ${status}`);
        if (status === WrenAISystemStatus.FINISHED) {
          deploySuccess = true;
          break;
        } else if (status === WrenAISystemStatus.FAILED) {
          break;
        } else if (status === WrenAISystemStatus.INDEXING) {
          // do nothing
        } else {
          logger.debug(`WrenAI: Unknown WrenAI deploy status: ${status}`);
          return;
        }
      } catch (err: any) {
        logger.debug(err);
        logger.debug(
          `Got error when waiting for deploy finished: ${err.message}`,
        );
        break;
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
    return {
      status,
      error,
      response: body?.response,
    };
  }

  private transformAskDetailResult(body: any): AskDetailResult {
    const { status, error } = this.transformStatusAndError(body);

    // snake_case to camelCase
    const steps = (body?.response?.steps || []).map((step: any) => ({
      summary: step.summary,
      sql: step.sql,
      cteName: step.cte_name,
    }));

    return {
      status,
      error,
      response: {
        description: body?.response?.description,
        steps,
      },
    };
  }

  private transformStatusAndError(body: any): {
    status: AskResultStatus;
    error?: {
      code: Errors.GeneralErrorCodes;
      message: string;
      shortMessage: string;
    } | null;
  } {
    // transform status to enum
    const status = AskResultStatus[
      body?.status?.toUpperCase()
    ] as AskResultStatus;

    if (!status) {
      throw new Error(`Unknown ask status: ${body?.status}`);
    }

    // use custom error to transform error
    const error = body?.error?.code ? Errors.create(body?.error?.code) : null;

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

  private transfromHistoryInput(history: AskHistory) {
    if (!history) {
      return null;
    }

    // make it snake_case
    return {
      ...history,
      steps: history.steps.map((step) => ({
        sql: step.sql,
        summary: step.summary,
        cte_name: step.cteName,
      })),
    };
  }
}
