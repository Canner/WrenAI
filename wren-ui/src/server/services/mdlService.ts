import { MDLBuilder } from '../mdl/mdlBuilder';
import {
  Deploy,
  IDeployLogRepository,
  IModelNestedColumnRepository,
  IModelColumnRepository,
  IModelRepository,
  Project,
  IProjectRepository,
  IKnowledgeBaseRepository,
  IRelationRepository,
  IViewRepository,
} from '../repositories';
import { Manifest, WrenEngineDataSourceType } from '../mdl/type';
import { DataSourceName } from '../types';
import {
  hasCanonicalRuntimeIdentity,
  resolvePersistedProjectBridgeId,
  toPersistedRuntimeIdentityPatch,
  PersistedRuntimeIdentitySource,
} from '@server/utils/persistedRuntimeIdentity';

export interface MakeCurrentModelMDLResult {
  manifest: Manifest;
  mdlBuilder: MDLBuilder;
  project: Project;
}

type MDLRuntimeIdentity = Pick<
  PersistedRuntimeIdentitySource,
  | 'projectId'
  | 'workspaceId'
  | 'knowledgeBaseId'
  | 'kbSnapshotId'
  | 'deployHash'
>;

type ProjectBridgeRecord = {
  projectId?: number | null;
};

export interface IMDLService {
  makeCurrentModelMDL(
    bridgeProjectId: number,
  ): Promise<MakeCurrentModelMDLResult>;
  makeCurrentModelMDLByRuntimeIdentity(
    runtimeIdentity: MDLRuntimeIdentity,
  ): Promise<MakeCurrentModelMDLResult>;
}

export class MDLService implements IMDLService {
  private projectRepository: IProjectRepository;
  private knowledgeBaseRepository?: IKnowledgeBaseRepository;
  private deployLogRepository: IDeployLogRepository;
  private modelRepository: IModelRepository;
  private modelColumnRepository: IModelColumnRepository;
  private modelNestedColumnRepository: IModelNestedColumnRepository;
  private relationRepository: IRelationRepository;
  private viewRepository: IViewRepository;

  constructor({
    projectRepository,
    knowledgeBaseRepository,
    deployLogRepository,
    modelRepository,
    modelColumnRepository,
    modelNestedColumnRepository,
    relationRepository,
    viewRepository,
  }: {
    projectRepository: IProjectRepository;
    knowledgeBaseRepository?: IKnowledgeBaseRepository;
    deployLogRepository: IDeployLogRepository;
    modelRepository: IModelRepository;
    modelColumnRepository: IModelColumnRepository;
    modelNestedColumnRepository: IModelNestedColumnRepository;
    relationRepository: IRelationRepository;
    viewRepository: IViewRepository;
  }) {
    this.projectRepository = projectRepository;
    this.knowledgeBaseRepository = knowledgeBaseRepository;
    this.deployLogRepository = deployLogRepository;
    this.modelRepository = modelRepository;
    this.modelColumnRepository = modelColumnRepository;
    this.modelNestedColumnRepository = modelNestedColumnRepository;
    this.relationRepository = relationRepository;
    this.viewRepository = viewRepository;
  }

  public async makeCurrentModelMDL(
    bridgeProjectId: number,
  ): Promise<MakeCurrentModelMDLResult> {
    const project = await this.projectRepository.findOneBy({
      id: bridgeProjectId,
    });
    if (!project) {
      throw new Error(`Project not found: ${bridgeProjectId}`);
    }

    const models = await this.modelRepository.findAllBy({
      projectId: bridgeProjectId,
    });
    const modelIds = models.map((m) => m.id);
    const columns =
      await this.modelColumnRepository.findColumnsByModelIds(modelIds);
    const modelNestedColumns =
      await this.modelNestedColumnRepository.findNestedColumnsByModelIds(
        modelIds,
      );
    const relations = await this.relationRepository.findRelationInfoBy({
      projectId: bridgeProjectId,
    });
    const views = await this.viewRepository.findAllBy({
      projectId: bridgeProjectId,
    });
    const relatedModels = models;
    const relatedColumns = columns;
    const relatedRelations = relations;
    const mdlBuilder = new MDLBuilder({
      project,
      models,
      columns,
      nestedColumns: modelNestedColumns,
      relations,
      views,
      relatedModels,
      relatedColumns,
      relatedRelations,
    });
    return { manifest: mdlBuilder.build(), mdlBuilder, project };
  }

  public async makeCurrentModelMDLByRuntimeIdentity(
    runtimeIdentity: MDLRuntimeIdentity,
  ) {
    const deployment =
      (await this.findDeploymentByHash(runtimeIdentity.deployHash)) ||
      (await this.findLatestCanonicalRuntimeDeployment(runtimeIdentity));
    const effectiveRuntimeIdentity = this.buildModelLookupRuntimeIdentity(
      runtimeIdentity,
      deployment,
    );
    const models = await this.modelRepository.findAllByRuntimeIdentity(
      effectiveRuntimeIdentity as any,
    );
    const { project } = await this.resolveProjectContextForRuntimeIdentity(
      effectiveRuntimeIdentity,
      models,
      deployment,
    );
    const modelIds = models.map((m) => m.id);
    const columns =
      await this.modelColumnRepository.findColumnsByModelIds(modelIds);
    const modelNestedColumns =
      await this.modelNestedColumnRepository.findNestedColumnsByModelIds(
        modelIds,
      );
    const relations = await this.relationRepository.findRelationInfoBy({
      modelIds,
    });
    const views = await this.viewRepository.findAllByRuntimeIdentity(
      effectiveRuntimeIdentity as any,
    );
    const relatedModels = models;
    const relatedColumns = columns;
    const relatedRelations = relations;
    const mdlBuilder = new MDLBuilder({
      project,
      models,
      columns,
      nestedColumns: modelNestedColumns,
      relations,
      views,
      relatedModels,
      relatedColumns,
      relatedRelations,
    });
    return { manifest: mdlBuilder.build(), mdlBuilder, project };
  }

  private resolveSingleBridgeProjectIdFromModels(
    models: ProjectBridgeRecord[] = [],
  ) {
    const modelBridgeProjectIds = [
      ...new Set(
        models
          .map((model) => model.projectId ?? null)
          .filter(
            (bridgeProjectId): bridgeProjectId is number =>
              bridgeProjectId != null,
          ),
      ),
    ];
    if (modelBridgeProjectIds.length === 1) {
      return modelBridgeProjectIds[0];
    }

    return null;
  }

  private async findDeploymentByHash(
    deployHash?: string | null,
  ): Promise<Deploy | null> {
    if (!deployHash) {
      return null;
    }

    return (
      (await this.deployLogRepository.findOneBy({
        hash: deployHash,
      })) || null
    );
  }

  private async findLatestCanonicalRuntimeDeployment(
    runtimeIdentity: Pick<
      MDLRuntimeIdentity,
      'workspaceId' | 'knowledgeBaseId' | 'kbSnapshotId'
    >,
  ): Promise<Deploy | null> {
    if (!hasCanonicalRuntimeIdentity(runtimeIdentity)) {
      return null;
    }

    return await this.deployLogRepository.findLastRuntimeDeployLog({
      ...this.buildCanonicalRuntimeDeployLookup(runtimeIdentity),
    } as any);
  }

  private buildModelLookupRuntimeIdentity(
    runtimeIdentity: MDLRuntimeIdentity,
    deployment: Deploy | null,
  ) {
    return toPersistedRuntimeIdentityPatch({
      ...runtimeIdentity,
      projectId: resolvePersistedProjectBridgeId(
        runtimeIdentity,
        this.resolveBridgeProjectIdFromDeployment(deployment),
      ),
      deployHash: runtimeIdentity.deployHash ?? deployment?.hash ?? null,
    });
  }

  private buildCanonicalRuntimeDeployLookup(
    runtimeIdentity: Pick<
      MDLRuntimeIdentity,
      'workspaceId' | 'knowledgeBaseId' | 'kbSnapshotId'
    >,
  ) {
    return toPersistedRuntimeIdentityPatch({
      projectId: null,
      workspaceId: runtimeIdentity.workspaceId ?? null,
      knowledgeBaseId: runtimeIdentity.knowledgeBaseId ?? null,
      kbSnapshotId: runtimeIdentity.kbSnapshotId ?? null,
      deployHash: null,
      actorUserId: null,
    });
  }

  private async resolveProjectContextForRuntimeIdentity(
    runtimeIdentity: MDLRuntimeIdentity,
    models: ProjectBridgeRecord[] = [],
    deployment: Deploy | null = null,
  ): Promise<{ deployment: Deploy | null; project: Project }> {
    const useCanonicalRuntimeIdentity =
      hasCanonicalRuntimeIdentity(runtimeIdentity);
    const modelBridgeProjectId =
      this.resolveSingleBridgeProjectIdFromModels(models);
    const resolvedDeployment =
      deployment ||
      (await this.findDeploymentByHash(runtimeIdentity.deployHash)) ||
      (await this.findLatestCanonicalRuntimeDeployment(runtimeIdentity));

    if (useCanonicalRuntimeIdentity) {
      if (modelBridgeProjectId) {
        return {
          deployment: resolvedDeployment,
          project: await this.resolveProjectByBridgeId(
            modelBridgeProjectId,
            resolvedDeployment,
          ),
        };
      }

      const deploymentBridgeProjectId =
        this.resolveBridgeProjectIdFromDeployment(resolvedDeployment);
      if (deploymentBridgeProjectId) {
        return {
          deployment: resolvedDeployment,
          project: await this.resolveProjectByBridgeId(
            deploymentBridgeProjectId,
            resolvedDeployment,
          ),
        };
      }

      if (runtimeIdentity.knowledgeBaseId) {
        const knowledgeBase = await this.knowledgeBaseRepository?.findOneBy({
          id: runtimeIdentity.knowledgeBaseId,
        });
        if (knowledgeBase?.runtimeProjectId) {
          return {
            deployment: resolvedDeployment,
            project: await this.resolveProjectByBridgeId(
              knowledgeBase.runtimeProjectId,
              resolvedDeployment,
            ),
          };
        }
      }
    } else {
      const runtimeBridgeProjectId =
        resolvePersistedProjectBridgeId(runtimeIdentity);
      if (runtimeBridgeProjectId) {
        return {
          deployment: resolvedDeployment,
          project: await this.resolveProjectByBridgeId(
            runtimeBridgeProjectId,
            resolvedDeployment,
          ),
        };
      }

      if (modelBridgeProjectId) {
        return {
          deployment: resolvedDeployment,
          project: await this.resolveProjectByBridgeId(
            modelBridgeProjectId,
            resolvedDeployment,
          ),
        };
      }

      const deploymentBridgeProjectId =
        this.resolveBridgeProjectIdFromDeployment(resolvedDeployment);
      if (deploymentBridgeProjectId) {
        return {
          deployment: resolvedDeployment,
          project: await this.resolveProjectByBridgeId(
            deploymentBridgeProjectId,
            resolvedDeployment,
          ),
        };
      }
    }

    throw new Error(
      useCanonicalRuntimeIdentity
        ? 'MDL runtime identity requires deploy metadata or resolvable project metadata'
        : 'MDL runtime identity requires a resolvable compatibility scope',
    );
  }

  private async resolveProjectByBridgeId(
    bridgeProjectId: number,
    deployment: Deploy | null = null,
  ): Promise<Project> {
    const project = await this.projectRepository.findOneBy({
      id: bridgeProjectId,
    });
    if (project) {
      return project;
    }

    const manifestBackedProject = this.buildManifestBackedProject(deployment);
    if (manifestBackedProject) {
      return manifestBackedProject;
    }

    throw new Error(`Project ${bridgeProjectId} not found`);
  }

  private resolveBridgeProjectIdFromDeployment(
    deployment: Deploy | null,
  ): number | null {
    return deployment?.projectId ?? null;
  }

  private buildManifestBackedProject(
    deployment: Deploy | null,
  ): Project | null {
    if (!deployment?.manifest) {
      return null;
    }

    const manifest = deployment.manifest as Manifest;
    if (!manifest.catalog || !manifest.schema || !manifest.dataSource) {
      return null;
    }

    const type = this.mapManifestDataSourceToProjectType(manifest.dataSource);
    if (!type) {
      return null;
    }

    const deploymentBridgeProjectId =
      this.resolveBridgeProjectIdFromDeployment(deployment);
    if (!deploymentBridgeProjectId) {
      return null;
    }

    return {
      id: deploymentBridgeProjectId,
      type,
      version: '',
      displayName: '',
      catalog: manifest.catalog,
      schema: manifest.schema,
      sampleDataset: null as any,
      connectionInfo: {} as any,
      language: undefined,
      queryId: undefined,
      questions: [],
      questionsStatus: undefined,
      questionsError: undefined,
    };
  }

  private mapManifestDataSourceToProjectType(
    dataSource: WrenEngineDataSourceType,
  ): DataSourceName | null {
    switch (dataSource) {
      case WrenEngineDataSourceType.ATHENA:
        return DataSourceName.ATHENA;
      case WrenEngineDataSourceType.BIGQUERY:
        return DataSourceName.BIG_QUERY;
      case WrenEngineDataSourceType.CLICKHOUSE:
        return DataSourceName.CLICK_HOUSE;
      case WrenEngineDataSourceType.MSSQL:
        return DataSourceName.MSSQL;
      case WrenEngineDataSourceType.ORACLE:
        return DataSourceName.ORACLE;
      case WrenEngineDataSourceType.MYSQL:
        return DataSourceName.MYSQL;
      case WrenEngineDataSourceType.POSTGRES:
        return DataSourceName.POSTGRES;
      case WrenEngineDataSourceType.SNOWFLAKE:
        return DataSourceName.SNOWFLAKE;
      case WrenEngineDataSourceType.TRINO:
        return DataSourceName.TRINO;
      case WrenEngineDataSourceType.DUCKDB:
        return DataSourceName.DUCKDB;
      case WrenEngineDataSourceType.REDSHIFT:
        return DataSourceName.REDSHIFT;
      case WrenEngineDataSourceType.DATABRICKS:
        return DataSourceName.DATABRICKS;
      default:
        return null;
    }
  }
}
