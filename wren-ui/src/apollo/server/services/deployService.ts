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
  getLastDeployment(projectId: number): Promise<Deploy>;
  getInProgressDeployment(projectId: number): Promise<Deploy>;
  createMDLHash(manifest: Manifest, projectId: number): string;
  getMDLByHash(hash: string): Promise<string>;
  deleteAllByProjectId(projectId: number): Promise<void>;
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
    return lastDeploy;
  }

  public async getInProgressDeployment(projectId) {
    return await this.deployLogRepository.findInProgressProjectDeployLog(
      projectId,
    );
  }

  public async deploy(manifest, projectId) {
    // generate hash of manifest
    const hash = this.createMDLHash(manifest, projectId);
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

  public createMDLHash(manifest: Manifest, projectId: number) {
    const manifestStr = JSON.stringify(manifest);
    const content = `${projectId} ${manifestStr}`;
    const hash = createHash('sha1').update(content).digest('hex');
    return hash;
  }

  public async getMDLByHash(hash: string) {
    const deploy = await this.deployLogRepository.findOneBy({ hash });
    if (!deploy) {
      return null;
    }
    let mdl = deploy.manifest;
    if (typeof deploy.manifest === 'string') {
      mdl = JSON.parse(deploy.manifest);
    }
    // return base64 encoded manifest
    return Buffer.from(JSON.stringify(mdl)).toString('base64');
  }

  public async deleteAllByProjectId(projectId: number): Promise<void> {
    // delete all deploy logs
    await this.deployLogRepository.deleteAllBy({ projectId });
  }
}
