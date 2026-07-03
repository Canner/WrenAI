import { WrenAIDeployStatusEnum } from '@server/models/adaptor';
import { IWrenAIAdaptor } from '../adaptors/wrenAIAdaptor';
import {
  Deploy,
  DeployStatusEnum,
  IDeployLogRepository,
} from '../repositories/deployLogRepository';
import { Manifest } from '../mdl/type';
import { createHash } from 'node:crypto';
import { getLogger } from '@server/utils';
import {
  PostHogTelemetry,
  TelemetryEvent,
  WrenService,
} from '../telemetry/telemetry';

const logger = getLogger('DeployService');
logger.level = 'debug';

const STALE_DEPLOYMENT_MS = 10 * 60 * 1000;

export interface DeployResponse {
  status: DeployStatusEnum;
  error?: string;
}

export interface MDLSyncResponse {
  isSyncronized: boolean;
}

export interface IDeployService {
  deploy(
    manifest: Manifest,
    projectId: number,
    force?: boolean,
  ): Promise<DeployResponse>;
  getLastDeployment(projectId: number): Promise<Deploy>;
  getInProgressDeployment(projectId: number): Promise<Deploy>;
  createMDLHash(manifest: Manifest, projectId: number): string;
  isSameDeployment(
    manifest: Manifest,
    projectId: number,
    deployment?: Deploy | null,
  ): boolean;
  getMDLByHash(hash: string): Promise<string>;
  deleteAllByProjectId(projectId: number): Promise<void>;
}

export class DeployService implements IDeployService {
  private wrenAIAdaptor: IWrenAIAdaptor;
  private deployLogRepository: IDeployLogRepository;
  private telemetry: PostHogTelemetry;

  constructor({
    wrenAIAdaptor,
    deployLogRepository,
    telemetry,
  }: {
    wrenAIAdaptor: IWrenAIAdaptor;
    deployLogRepository: IDeployLogRepository;
    telemetry: PostHogTelemetry;
  }) {
    this.wrenAIAdaptor = wrenAIAdaptor;
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
    const inProgressDeploy = await this.deployLogRepository.findInProgressProjectDeployLog(
      projectId,
    );
    if (!inProgressDeploy) {
      return null;
    }

    const updatedAt = inProgressDeploy.updatedAt || inProgressDeploy.createdAt;
    const updatedAtTime = updatedAt ? new Date(updatedAt).getTime() : 0;
    if (updatedAtTime > 0 && Date.now() - updatedAtTime > STALE_DEPLOYMENT_MS) {
      await this.markDeploymentFailed(
        inProgressDeploy,
        'Deployment timed out before completion.',
      );
      return null;
    }

    return inProgressDeploy;
  }

  public async deploy(manifest, projectId, force = false) {
    const eventName = TelemetryEvent.MODELING_DEPLOY_MDL;
    let deploy: Deploy | null = null;
    try {
      // generate hash of manifest
      const hash = this.createMDLHash(manifest, projectId);
      logger.debug(`Deploying model, hash: ${hash}`);

      if (!force) {
        // check if the model current deployment
        const lastDeploy =
          await this.deployLogRepository.findLastProjectDeployLog(projectId);
        if (lastDeploy && lastDeploy.hash === hash) {
          logger.log(`Model has been deployed, hash: ${hash}`);
          return { status: DeployStatusEnum.SUCCESS };
        }
      }
      const previousInProgressDeploy =
        await this.deployLogRepository.findInProgressProjectDeployLog(projectId);
      if (previousInProgressDeploy) {
        await this.markDeploymentFailed(
          previousInProgressDeploy,
          'Deployment was superseded by a new deployment.',
        );
      }

      const deployData = {
        manifest,
        hash,
        projectId,
        status: DeployStatusEnum.IN_PROGRESS,
      } as Deploy;
      deploy = await this.deployLogRepository.createOne(deployData);

      // deploy to AI-service
      const { status: aiStatus, error: aiError } =
        await this.wrenAIAdaptor.deploy({
          manifest,
          hash,
          projectId,
        });

      // update deploy status
      const status =
        aiStatus === WrenAIDeployStatusEnum.SUCCESS
          ? DeployStatusEnum.SUCCESS
          : DeployStatusEnum.FAILED;
      await this.deployLogRepository.updateOne(deploy.id, {
        status,
        error: aiError,
      });

      // telemetry
      if (status === DeployStatusEnum.SUCCESS) {
        this.telemetry.sendEvent(eventName);
      } else {
        this.telemetry.sendEvent(
          eventName,
          { mdl: manifest, error: aiError },
          WrenService.AI,
          false,
        );
      }
      return { status, error: aiError };
    } catch (err: any) {
      logger.error(`Error deploying model: ${err.message}`);
      if (deploy?.id) {
        try {
          await this.markDeploymentFailed(deploy, err.message);
        } catch (updateErr: any) {
          logger.error(`Error marking deployment failed: ${updateErr.message}`);
        }
      }
      this.telemetry.sendEvent(
        eventName,
        { mdl: manifest, error: err.message },
        err.extensions?.service,
        false,
      );
      return { status: DeployStatusEnum.FAILED, error: err.message };
    }
  }

  private async markDeploymentFailed(deploy: Deploy, error: string) {
    await this.deployLogRepository.updateOne(deploy.id, {
      status: DeployStatusEnum.FAILED,
      error,
    });
  }

  public createMDLHash(manifest: Manifest, projectId: number) {
    const manifestStr = this.canonicalStringify(manifest);
    const content = `${projectId} ${manifestStr}`;
    const hash = createHash('sha1').update(content).digest('hex');
    return hash;
  }

  public isSameDeployment(
    manifest: Manifest,
    projectId: number,
    deployment?: Deploy | null,
  ) {
    if (!deployment) {
      return false;
    }

    if (deployment.hash === this.createMDLHash(manifest, projectId)) {
      return true;
    }

    return (
      this.canonicalStringify(deployment.manifest) ===
      this.canonicalStringify(manifest)
    );
  }

  private canonicalStringify(value: any): string {
    if (Array.isArray(value)) {
      const serializedItems = value.map((item) => this.canonicalStringify(item));
      if (value.every((item) => item && typeof item === 'object')) {
        serializedItems.sort();
      }
      return `[${serializedItems.join(',')}]`;
    }

    if (value && typeof value === 'object') {
      return `{${Object.keys(value)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${this.canonicalStringify(value[key])}`)
        .join(',')}}`;
    }

    return JSON.stringify(value);
  }

  public async getMDLByHash(hash: string) {
    const deploy = await this.deployLogRepository.findOneBy({ hash });
    if (!deploy) {
      return null;
    }
    // return base64 encoded manifest
    return Buffer.from(JSON.stringify(deploy.manifest)).toString('base64');
  }

  public async deleteAllByProjectId(projectId: number): Promise<void> {
    // delete all deploy logs
    await this.deployLogRepository.deleteAllBy({ projectId });
  }
}
