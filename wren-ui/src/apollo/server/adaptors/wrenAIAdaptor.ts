import axios, { AxiosError } from 'axios';
import { Manifest } from '../mdl/type';
import { getLogger } from '@server/utils';

const logger = getLogger('WrenAIAdaptor');
logger.level = 'debug';

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

export interface IWrenAIAdaptor {
  deploy(deployData: deployData): Promise<WrenAIDeployResponse>;
}

export class WrenAIAdaptor implements IWrenAIAdaptor {
  private readonly wrenAIBaseEndpoint: string;
  constructor({ wrenAIBaseEndpoint }: { wrenAIBaseEndpoint: string }) {
    this.wrenAIBaseEndpoint = wrenAIBaseEndpoint;
  }
  public async deploy(deployData: deployData): Promise<WrenAIDeployResponse> {
    const { manifest, hash } = deployData;
    try {
      const res = await axios.post(
        `${this.wrenAIBaseEndpoint}/v1/semantics-preparations`,
        { mdl: JSON.stringify(manifest), id: hash },
      );
      const deployId = res.data.id;
      const deploySuccess = await this.waitDeployFinished(deployId);
      if (deploySuccess) {
        logger.debug(`WrenAI: Deploy wren AI success, hash: ${hash}`);
        return { status: WrenAIDeployStatusEnum.SUCCESS };
      } else {
        return {
          status: WrenAIDeployStatusEnum.FAILED,
          error: 'WrenAI: Deploy wren AI failed or timeout, hash: ${hash}',
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
      return res.data?.status as WrenAISystemStatus;
    } catch (err: any) {
      logger.debug(
        `Got error in API /v1/semantics-preparations/${deployId}/status: ${err.message}`,
      );
      throw err;
    }
  }
}
