import {
  IWrenAIAdaptor,
  WrenAIDeployStatusEnum,
} from '../adaptors/wrenAIAdaptor';
import {
  IWrenEngineAdaptor,
  WrenEngineDeployStatusEnum,
} from '../adaptors/wrenEngineAdaptor';
import {
  Deploy,
  DeployStatusEnum,
  IDeployLogRepository,
} from '../repositories/deployLogRepository';
import { Manifest } from '../mdl/type';
import { createHash } from 'node:crypto';
import { getLogger } from '@server/utils';
import { Telemetry } from '../telemetry/telemetry';

const logger = getLogger('DeployService');
logger.level = 'debug';

export interface DeployResponse {
  status: DeployStatusEnum;
  error?: string;
}

export interface MDLSyncResponse {
  isSyncronized: boolean;
}

export interface IDeployService {
  deploy(manifest: Manifest, projectId: number): Promise<DeployResponse>;
  getLastDeployment(projectId: number): Promise<string>;
  getInProgressDeployment(projectId: number): Promise<Deploy>;
  createMDLHash(manifest: Manifest): string;
}

export class DeployService implements IDeployService {
  private wrenAIAdaptor: IWrenAIAdaptor;
  private wrenEngineAdaptor: IWrenEngineAdaptor;
  private deployLogRepository: IDeployLogRepository;
  private telemetry: Telemetry;

  constructor({
    wrenAIAdaptor,
    wrenEngineAdaptor,
    deployLogRepository,
    telemetry,
  }: {
    wrenAIAdaptor: IWrenAIAdaptor;
    wrenEngineAdaptor: IWrenEngineAdaptor;
    deployLogRepository: IDeployLogRepository;
    telemetry: Telemetry;
  }) {
    this.wrenAIAdaptor = wrenAIAdaptor;
    this.wrenEngineAdaptor = wrenEngineAdaptor;
    this.deployLogRepository = deployLogRepository;
    this.telemetry = telemetry;
  }

  public async getLastDeployment(projectId) {
    const lastDeploy =
      await this.deployLogRepository.findLastProjectDeployLog(projectId);
    if (!lastDeploy) {
      return null;
    }
    return lastDeploy.hash;
  }

  public async getInProgressDeployment(projectId) {
    return await this.deployLogRepository.findInProgressProjectDeployLog(
      projectId,
    );
  }

  public async deploy(manifest, projectId) {
    // generate hash of manifest
    const hash = this.createMDLHash(manifest);
    logger.debug(`Deploying model, hash: ${hash}`);
    logger.debug(JSON.stringify(manifest));

    // check if the model current deployment
    const lastDeploy =
      await this.deployLogRepository.findLastProjectDeployLog(projectId);
    if (lastDeploy && lastDeploy.hash === hash) {
      logger.log(`Model has been deployed, hash: ${hash}`);
      return { status: DeployStatusEnum.SUCCESS };
    }

    const deployData = {
      manifest,
      hash,
      projectId,
      status: DeployStatusEnum.IN_PROGRESS,
    } as Deploy;
    const deploy = await this.deployLogRepository.createOne(deployData);

    // deploy to wren-engine & AI-service
    const [engineRes, aiRes] = await Promise.all([
      this.wrenEngineAdaptor.deploy({ manifest, hash }),
      this.wrenAIAdaptor.deploy({ manifest, hash }),
    ]);

    // store deploy log
    const status =
      engineRes.status === WrenEngineDeployStatusEnum.SUCCESS &&
      aiRes.status === WrenAIDeployStatusEnum.SUCCESS
        ? DeployStatusEnum.SUCCESS
        : DeployStatusEnum.FAILED;
    const error = engineRes.error || aiRes.error;
    await this.deployLogRepository.updateOne(deploy.id, { status, error });
    if (status === DeployStatusEnum.SUCCESS) {
      this.telemetry.send_event('deploy_model', { mdl: manifest });
    }
    return { status, error };
  }

  public createMDLHash(manifest: Manifest) {
    const content = JSON.stringify(manifest);
    const hash = createHash('sha1').update(content).digest('hex');
    return hash;
  }
}
