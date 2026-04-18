import {
  AskRuntimeIdentity,
  WrenAIDeployStatusEnum,
} from '@server/models/adaptor';
import { PersistedRuntimeIdentity } from '@server/context/runtimeScope';
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
  hasCanonicalRuntimeIdentity,
  requirePersistedProjectBridgeId,
  resolvePersistedProjectBridgeId,
  resolveRuntimeScopeIdFromPersistedIdentityWithProjectBridgeFallback,
  toPersistedRuntimeIdentityPatch,
  PersistedRuntimeIdentitySource,
} from '@server/utils/persistedRuntimeIdentity';
import {
  PostHogTelemetry,
  TelemetryEvent,
  WrenService,
} from '../telemetry/telemetry';

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
  deploy(
    manifest: Manifest,
    runtimeIdentity: AskRuntimeIdentity | PersistedRuntimeIdentity,
    force?: boolean,
  ): Promise<DeployResponse>;
  getLastDeployment(bridgeProjectId: number): Promise<Deploy | null>;
  getLastDeploymentByRuntimeIdentity(
    runtimeIdentity: RuntimeDeploymentLookupIdentity,
  ): Promise<Deploy | null>;
  getDeployment(
    bridgeProjectId: number,
    hash?: string | null,
  ): Promise<Deploy | null>;
  getDeploymentByRuntimeIdentity(
    runtimeIdentity: RuntimeDeploymentLookupIdentity,
  ): Promise<Deploy | null>;
  getInProgressDeployment(bridgeProjectId: number): Promise<Deploy | null>;
  getInProgressDeploymentByRuntimeIdentity(
    runtimeIdentity: RuntimeDeploymentLookupIdentity,
  ): Promise<Deploy | null>;
  createMDLHash(manifest: Manifest, bridgeProjectId: number): string;
  createMDLHashByRuntimeIdentity(
    manifest: Manifest,
    runtimeIdentity: RuntimeDeploymentLookupIdentity,
    fallbackProjectBridgeId?: number | null,
  ): string;
  getMDLByHash(hash: string): Promise<string | null>;
  deleteAllByProjectId(bridgeProjectId: number): Promise<void>;
}

type RuntimeDeploymentLookupIdentity = Pick<
  PersistedRuntimeIdentitySource,
  | 'projectId'
  | 'workspaceId'
  | 'knowledgeBaseId'
  | 'kbSnapshotId'
  | 'deployHash'
>;

type CanonicalRuntimeDeploymentLookupIdentity = Pick<
  PersistedRuntimeIdentitySource,
  'workspaceId' | 'knowledgeBaseId' | 'kbSnapshotId' | 'deployHash'
>;

const toAdaptorRuntimeIdentity = (
  runtimeIdentity: PersistedRuntimeIdentity,
): AskRuntimeIdentity => ({
  projectId: runtimeIdentity.projectId ?? undefined,
  workspaceId: runtimeIdentity.workspaceId ?? null,
  knowledgeBaseId: runtimeIdentity.knowledgeBaseId ?? null,
  kbSnapshotId: runtimeIdentity.kbSnapshotId ?? null,
  deployHash: runtimeIdentity.deployHash ?? null,
  actorUserId: runtimeIdentity.actorUserId ?? null,
});

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

  public async getLastDeployment(bridgeProjectId: number) {
    const lastDeploy =
      await this.deployLogRepository.findLastProjectDeployLog(bridgeProjectId);
    if (!lastDeploy) {
      return null;
    }
    return lastDeploy;
  }

  public async getLastDeploymentByRuntimeIdentity(
    runtimeIdentity: RuntimeDeploymentLookupIdentity,
  ) {
    const deployment = await this.findDeploymentByDeployHash(
      runtimeIdentity.deployHash,
      { status: DeployStatusEnum.SUCCESS },
    );
    if (deployment) {
      return deployment;
    }

    const runtimeDeployment =
      await this.findLatestCanonicalRuntimeDeployment(runtimeIdentity);
    if (runtimeDeployment) {
      return runtimeDeployment;
    }

    const bridgeProjectId =
      await this.resolveProjectBridgeIdForRuntimeLookup(runtimeIdentity);
    if (!bridgeProjectId) {
      return null;
    }

    return await this.getLastDeployment(bridgeProjectId);
  }

  public async getDeployment(bridgeProjectId: number, hash?: string | null) {
    if (hash) {
      const deployment =
        await this.deployLogRepository.findLatestDeployLogByHash(hash, {
          projectId: bridgeProjectId,
          status: DeployStatusEnum.SUCCESS,
        });
      const fallbackDeployment =
        deployment ||
        (await this.deployLogRepository.findLatestDeployLogByHash(hash, {
          projectId: bridgeProjectId,
        }));
      if (fallbackDeployment) {
        return fallbackDeployment;
      }
    }

    return await this.getLastDeployment(bridgeProjectId);
  }

  public async getDeploymentByRuntimeIdentity(
    runtimeIdentity: RuntimeDeploymentLookupIdentity,
  ) {
    const deployment = await this.findDeploymentByDeployHash(
      runtimeIdentity.deployHash,
      { status: DeployStatusEnum.SUCCESS },
    );
    if (deployment) {
      return deployment;
    }

    const runtimeDeployment =
      await this.findLatestCanonicalRuntimeDeployment(runtimeIdentity);
    if (runtimeDeployment) {
      return runtimeDeployment;
    }

    const bridgeProjectId =
      await this.resolveProjectBridgeIdForRuntimeLookup(runtimeIdentity);
    if (!bridgeProjectId) {
      return null;
    }

    return await this.getDeployment(
      bridgeProjectId,
      runtimeIdentity.deployHash,
    );
  }

  public async getInProgressDeployment(bridgeProjectId: number) {
    return await this.deployLogRepository.findInProgressProjectDeployLog(
      bridgeProjectId,
    );
  }

  public async getInProgressDeploymentByRuntimeIdentity(
    runtimeIdentity: RuntimeDeploymentLookupIdentity,
  ) {
    const deployment = await this.findDeploymentByDeployHash(
      runtimeIdentity.deployHash,
      { status: DeployStatusEnum.IN_PROGRESS },
    );
    if (deployment?.status === DeployStatusEnum.IN_PROGRESS) {
      return deployment;
    }

    if (deployment) {
      return await this.getInProgressDeployment(deployment.projectId);
    }

    const runtimeDeployment =
      await this.findLatestInProgressCanonicalRuntimeDeployment(
        runtimeIdentity,
      );
    if (runtimeDeployment) {
      return runtimeDeployment;
    }

    const bridgeProjectId =
      await this.resolveProjectBridgeIdForRuntimeLookup(runtimeIdentity);
    if (!bridgeProjectId) {
      return null;
    }

    return await this.getInProgressDeployment(bridgeProjectId);
  }

  public async deploy(
    manifest: Manifest,
    runtimeIdentity: AskRuntimeIdentity | PersistedRuntimeIdentity,
    force = false,
  ) {
    const eventName = TelemetryEvent.MODELING_DEPLOY_MDL;
    try {
      const bridgeProjectId = await this.resolveDeployProjectBridgeId(
        runtimeIdentity,
        'deploy',
      );
      // generate hash of manifest
      const hash = this.createMDLHashByRuntimeIdentity(
        manifest,
        runtimeIdentity,
        bridgeProjectId,
      );
      logger.debug(`Deploying model, hash: ${hash}`);

      if (!force) {
        // check if the model current deployment
        const lastDeploy =
          await this.deployLogRepository.findLastProjectDeployLog(
            bridgeProjectId,
          );
        if (lastDeploy && lastDeploy.hash === hash) {
          logger.log(`Model has been deployed, hash: ${hash}`);
          return { status: DeployStatusEnum.SUCCESS };
        }
      }
      const deployData = {
        manifest,
        hash,
        projectId: bridgeProjectId,
        ...this.buildPersistedDeploymentRuntimeIdentity(runtimeIdentity, hash),
        status: DeployStatusEnum.IN_PROGRESS,
      } as Deploy;
      const deploy = await this.deployLogRepository.createOne(deployData);

      // deploy to AI-service
      const persistedAiRuntimeIdentity = toPersistedRuntimeIdentityPatch({
        ...runtimeIdentity,
        deployHash: hash,
      });
      const aiRuntimeIdentity = toAdaptorRuntimeIdentity(
        persistedAiRuntimeIdentity,
      );
      const { status: aiStatus, error: aiError } =
        await this.wrenAIAdaptor.deploy({
          manifest,
          hash,
          runtimeIdentity: aiRuntimeIdentity,
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
      this.telemetry.sendEvent(
        eventName,
        { mdl: manifest, error: err.message },
        err.extensions?.service,
        false,
      );
      return { status: DeployStatusEnum.FAILED, error: err.message };
    }
  }

  public createMDLHash(manifest: Manifest, bridgeProjectId: number) {
    const manifestStr = JSON.stringify(manifest);
    const content = `${bridgeProjectId} ${manifestStr}`;
    const hash = createHash('sha1').update(content).digest('hex');
    return hash;
  }

  public createMDLHashByRuntimeIdentity(
    manifest: Manifest,
    runtimeIdentity: RuntimeDeploymentLookupIdentity,
    fallbackProjectBridgeId?: number | null,
  ) {
    const scopeKey =
      resolveRuntimeScopeIdFromPersistedIdentityWithProjectBridgeFallback(
        runtimeIdentity,
        fallbackProjectBridgeId,
      );

    if (scopeKey == null) {
      throw new Error('createMDLHashByRuntimeIdentity requires a scope key');
    }

    const manifestStr = JSON.stringify(manifest);
    const content = `${scopeKey} ${manifestStr}`;
    return createHash('sha1').update(content).digest('hex');
  }

  public async getMDLByHash(hash: string): Promise<string | null> {
    const deploy =
      (await this.deployLogRepository.findLatestDeployLogByHash(hash, {
        status: DeployStatusEnum.SUCCESS,
      })) || (await this.deployLogRepository.findLatestDeployLogByHash(hash));
    if (!deploy) {
      return null;
    }
    // return base64 encoded manifest
    return Buffer.from(JSON.stringify(deploy.manifest)).toString('base64');
  }

  public async deleteAllByProjectId(bridgeProjectId: number): Promise<void> {
    // delete all deploy logs
    await this.deployLogRepository.deleteAllBy({
      projectId: bridgeProjectId,
    });
  }

  private async resolveDeployProjectBridgeId(
    runtimeIdentity: RuntimeDeploymentLookupIdentity,
    action: string,
  ) {
    const explicitProjectId =
      !runtimeIdentity.deployHash &&
      resolvePersistedProjectBridgeId(runtimeIdentity);
    if (explicitProjectId) {
      return explicitProjectId;
    }

    const bridgeProjectId =
      await this.resolveProjectBridgeIdForRuntimeLookup(runtimeIdentity);
    if (bridgeProjectId) {
      return bridgeProjectId;
    }

    return requirePersistedProjectBridgeId(runtimeIdentity, action);
  }

  private async findDeploymentByDeployHash(
    deployHash?: string | null,
    options?: {
      projectId?: number | null;
      status?: DeployStatusEnum;
    },
  ): Promise<Deploy | null> {
    if (!deployHash) {
      return null;
    }

    const prioritizedMatch =
      await this.deployLogRepository.findLatestDeployLogByHash(
        deployHash,
        options,
      );
    if (prioritizedMatch) {
      return prioritizedMatch;
    }

    return (
      (await this.deployLogRepository.findLatestDeployLogByHash(deployHash)) ||
      null
    );
  }

  private async findLatestCanonicalRuntimeDeployment(
    runtimeIdentity: CanonicalRuntimeDeploymentLookupIdentity,
  ): Promise<Deploy | null> {
    if (!hasCanonicalRuntimeIdentity(runtimeIdentity)) {
      return null;
    }

    return await this.deployLogRepository.findLastRuntimeDeployLog(
      this.buildCanonicalRuntimeDeploymentLookup(runtimeIdentity),
    );
  }

  private async findLatestInProgressCanonicalRuntimeDeployment(
    runtimeIdentity: CanonicalRuntimeDeploymentLookupIdentity,
  ): Promise<Deploy | null> {
    if (!hasCanonicalRuntimeIdentity(runtimeIdentity)) {
      return null;
    }

    return await this.deployLogRepository.findInProgressRuntimeDeployLog(
      this.buildCanonicalRuntimeDeploymentLookup(runtimeIdentity),
    );
  }

  private async resolveProjectBridgeIdForRuntimeLookup(
    runtimeIdentity: RuntimeDeploymentLookupIdentity,
  ): Promise<number | null> {
    const deployment = await this.findDeploymentByDeployHash(
      runtimeIdentity.deployHash,
    );
    if (deployment?.projectId) {
      return deployment.projectId;
    }

    const runtimeDeployment =
      await this.findLatestCanonicalRuntimeDeployment(runtimeIdentity);
    if (runtimeDeployment?.projectId) {
      return runtimeDeployment.projectId;
    }

    if (hasCanonicalRuntimeIdentity(runtimeIdentity)) {
      return null;
    }

    return resolvePersistedProjectBridgeId(runtimeIdentity);
  }

  private buildCanonicalRuntimeDeploymentLookup(
    runtimeIdentity: CanonicalRuntimeDeploymentLookupIdentity,
  ): PersistedRuntimeIdentity {
    return toPersistedRuntimeIdentityPatch({
      projectId: null,
      workspaceId: runtimeIdentity.workspaceId ?? null,
      knowledgeBaseId: runtimeIdentity.knowledgeBaseId ?? null,
      kbSnapshotId: runtimeIdentity.kbSnapshotId ?? null,
      deployHash: null,
      actorUserId: null,
    });
  }

  private buildPersistedDeploymentRuntimeIdentity(
    runtimeIdentity: AskRuntimeIdentity | PersistedRuntimeIdentity,
    hash: string,
  ): Pick<
    Deploy,
    | 'workspaceId'
    | 'knowledgeBaseId'
    | 'kbSnapshotId'
    | 'deployHash'
    | 'actorUserId'
  > {
    const { projectId: _ignoredProjectId, ...persistedRuntimeIdentity } =
      toPersistedRuntimeIdentityPatch({
        ...runtimeIdentity,
        deployHash: hash,
      });

    return persistedRuntimeIdentity;
  }
}
