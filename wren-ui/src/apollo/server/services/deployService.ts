import {
  WrenAIDeployStatusEnum,
  WrenAISystemStatus,
} from '@server/models/adaptor';
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
const DEFAULT_DEPLOY_STATUS_POLLING_INTERVAL_MS = 2000;
const DEFAULT_DEPLOY_STATUS_MAX_ATTEMPTS = 90;

export interface DeployResponse {
  status: DeployStatusEnum;
  error?: string;
  hash?: string;
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
  ensureDeploymentPrepared(projectId: number): Promise<string>;
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
  private deploymentPollingIntervalMs: number;
  private deploymentMaxAttempts: number;

  constructor({
    wrenAIAdaptor,
    deployLogRepository,
    telemetry,
    deploymentPollingIntervalMs = DEFAULT_DEPLOY_STATUS_POLLING_INTERVAL_MS,
    deploymentMaxAttempts = DEFAULT_DEPLOY_STATUS_MAX_ATTEMPTS,
  }: {
    wrenAIAdaptor: IWrenAIAdaptor;
    deployLogRepository: IDeployLogRepository;
    telemetry: PostHogTelemetry;
    deploymentPollingIntervalMs?: number;
    deploymentMaxAttempts?: number;
  }) {
    this.wrenAIAdaptor = wrenAIAdaptor;
    this.deployLogRepository = deployLogRepository;
    this.telemetry = telemetry;
    this.deploymentPollingIntervalMs = deploymentPollingIntervalMs;
    this.deploymentMaxAttempts = deploymentMaxAttempts;
  }

  public async getLastDeployment(projectId) {
    const lastDeploy =
      await this.deployLogRepository.findLastProjectDeployLog(projectId);
    if (!lastDeploy) {
      return null;
    }
    return lastDeploy;
  }

  public async ensureDeploymentPrepared(projectId: number): Promise<string> {
    const lastDeploy =
      await this.deployLogRepository.findLastProjectDeployLog(projectId);
    if (!lastDeploy) {
      throw new Error(`No deployment found for project ${projectId}`);
    }
    const activeHash = this.createMDLHash(lastDeploy.manifest, projectId);

    if (lastDeploy.hash === activeHash) {
      let status: WrenAISystemStatus | null = null;
      try {
        status = await this.wrenAIAdaptor.getDeployStatus(
          activeHash,
          projectId,
        );
      } catch (err: any) {
        logger.warn(
          `Deployment ${activeHash} is not available in AI service: ${err.message}`,
        );
      }

      if (status === WrenAISystemStatus.FINISHED) {
        return activeHash;
      }
      if (status === WrenAISystemStatus.INDEXING) {
        logger.warn(
          `Deployment ${activeHash} is already indexing in AI service; waiting for it to finish instead of starting another deployment.`,
        );
        const isReady = await this.waitForDeploymentReady(
          activeHash,
          projectId,
          status,
        );
        if (isReady) {
          return activeHash;
        }
        throw new Error(
          `Deployment ${activeHash} did not finish indexing before timeout.`,
        );
      }
      if (status) {
        logger.warn(
          `Deployment ${activeHash} is not ready in AI service: ${status}`,
        );
      }
    } else {
      logger.warn(
        `Deployment ${lastDeploy.hash} does not match current manifest hash ${activeHash}; preparing current hash.`,
      );
    }

    const result = await this.deploy(lastDeploy.manifest, projectId);
    if (result.status !== DeployStatusEnum.SUCCESS) {
      throw new Error(
        result.error ||
          `Failed to prepare deployment ${lastDeploy.hash} for project ${projectId}`,
      );
    }

    return result.hash || activeHash;
  }

  private async waitForDeploymentReady(
    hash: string,
    projectId: number,
    initialStatus?: WrenAISystemStatus,
  ): Promise<boolean> {
    let status = initialStatus;
    for (let attempt = 1; attempt <= this.deploymentMaxAttempts; attempt++) {
      if (!status || attempt > 1) {
        status = await this.wrenAIAdaptor.getDeployStatus(hash, projectId);
      }

      logger.debug(
        `Deployment ${hash} status while waiting: ${status}, attempt: ${attempt}/${this.deploymentMaxAttempts}`,
      );

      if (status === WrenAISystemStatus.FINISHED) {
        return true;
      }
      if (status === WrenAISystemStatus.FAILED) {
        return false;
      }

      if (attempt < this.deploymentMaxAttempts) {
        await new Promise((resolve) =>
          setTimeout(resolve, this.deploymentPollingIntervalMs),
        );
      }
    }

    return false;
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
          logger.log(`Model has been deployed, refreshing AI index, hash: ${hash}`);
          deploy = lastDeploy;
          const { status: aiStatus, error: aiError } =
            await this.wrenAIAdaptor.deploy({
              manifest,
              hash,
              projectId,
            });
          const status =
            aiStatus === WrenAIDeployStatusEnum.SUCCESS
              ? DeployStatusEnum.SUCCESS
              : DeployStatusEnum.FAILED;
          await this.deployLogRepository.updateOne(lastDeploy.id, {
            status,
            error: aiError,
          });
          return { status, error: aiError, hash };
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
      return { status, error: aiError, hash };
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
