import { Knex } from 'knex';
import {
  buildInitSql,
  getRelations,
  sampleDatasets,
  SampleDatasetName,
} from '@server/data';
import { getLogger } from '@server/utils';
import {
  DeployStatusEnum,
  KnowledgeBase,
  Model,
  ModelColumn,
  Workspace,
} from '../repositories';
import { findOrCreateSystemSampleProject } from './workspaceBootstrapServiceSupport';
import { RelationType } from '../types';
import {
  IWorkspaceBootstrapService,
  SampleRuntimeSeedMode,
  WorkspaceBootstrapRuntimeDeps,
  WorkspaceBootstrapServiceDependencies,
} from './workspaceBootstrapServiceTypes';
import {
  buildRelationInput as buildRelationInputHelper,
  createModelsAndColumns as createModelsAndColumnsHelper,
  ensureDefaultWorkspaceRecord,
  ensureSystemSampleKnowledgeBases,
  prepareDuckDBEnvironment as prepareDuckDBEnvironmentHelper,
  toSampleDatasetName,
} from './workspaceBootstrapServiceSupport';
import {
  ensureSystemSampleSnapshot,
  pickPrimarySystemSampleKnowledgeBase,
  resolveExistingSampleDeployment,
  sortSystemSampleKnowledgeBasesForSeeding,
  syncRuntimeScopedArtifacts,
  syncSystemSampleKnowledgeBase,
  warmSystemSampleRuntimesInBackground,
} from './workspaceBootstrapServiceRuntimeSupport';

const logger = getLogger('WorkspaceBootstrapService');
logger.level = 'debug';

export type {
  IWorkspaceBootstrapService,
  SampleRuntimeSeedMode,
} from './workspaceBootstrapServiceTypes';

export class WorkspaceBootstrapService implements IWorkspaceBootstrapService {
  private readonly runtimeSeedJobs = new Map<string, Promise<void>>();
  private readonly workspaceWarmupJobs = new Map<string, Promise<void>>();

  constructor(private readonly deps: WorkspaceBootstrapServiceDependencies) {}

  private get runtimeDeps(): WorkspaceBootstrapRuntimeDeps {
    return {
      ...this.deps,
      runtimeSeedJobs: this.runtimeSeedJobs,
      workspaceWarmupJobs: this.workspaceWarmupJobs,
    };
  }

  public async findDefaultWorkspace({
    tx,
  }: {
    tx?: Knex.Transaction;
  } = {}): Promise<Workspace | null> {
    return await this.deps.workspaceRepository.findOneBy(
      { kind: 'default' },
      tx ? { tx } : undefined,
    );
  }

  public async ensureDefaultWorkspaceWithSamples({
    tx,
    runtimeSeedMode,
  }: {
    tx?: Knex.Transaction;
    runtimeSeedMode?: SampleRuntimeSeedMode;
  } = {}): Promise<Workspace> {
    const workspace = await ensureDefaultWorkspaceRecord({
      tx,
      workspaceRepository: this.deps.workspaceRepository,
    });
    const knowledgeBases = await ensureSystemSampleKnowledgeBases(
      workspace,
      this.deps,
      { tx },
    );
    const effectiveSeedMode: SampleRuntimeSeedMode = tx
      ? 'metadata_only'
      : runtimeSeedMode || 'all';

    if (effectiveSeedMode === 'default_only') {
      const primaryKnowledgeBase =
        pickPrimarySystemSampleKnowledgeBase(knowledgeBases);
      if (primaryKnowledgeBase) {
        await this.ensureSystemSampleRuntime(primaryKnowledgeBase);
      }
      this.warmSystemSampleRuntimesInBackground(
        workspace.id,
        knowledgeBases,
        primaryKnowledgeBase?.id || null,
      );
    } else if (effectiveSeedMode === 'background_all') {
      this.warmSystemSampleRuntimesInBackground(
        workspace.id,
        knowledgeBases,
        null,
      );
    } else if (effectiveSeedMode === 'all') {
      for (const knowledgeBase of sortSystemSampleKnowledgeBasesForSeeding(
        knowledgeBases,
      )) {
        await this.ensureSystemSampleRuntime(knowledgeBase);
      }
    }

    return workspace;
  }

  public async ensureDefaultWorkspaceSampleRuntime({
    sampleDataset,
    tx,
  }: {
    sampleDataset: SampleDatasetName;
    tx?: Knex.Transaction;
  }): Promise<{
    workspace: Workspace;
    knowledgeBase: KnowledgeBase;
  }> {
    const workspace = await this.ensureDefaultWorkspaceWithSamples({
      tx,
      runtimeSeedMode: 'metadata_only',
    });
    const knowledgeBase = await this.deps.knowledgeBaseRepository.findOneBy(
      {
        workspaceId: workspace.id,
        sampleDataset,
      },
      tx ? { tx } : undefined,
    );

    if (!knowledgeBase) {
      throw new Error(
        `System sample knowledge base for ${sampleDataset} was not found in workspace ${workspace.id}`,
      );
    }

    if (!tx) {
      await this.ensureSystemSampleRuntime(knowledgeBase);
    }

    return { workspace, knowledgeBase };
  }

  private async ensureSystemSampleRuntime(
    knowledgeBase: KnowledgeBase,
  ): Promise<void> {
    const existingJob = this.runtimeSeedJobs.get(knowledgeBase.id);
    if (existingJob) {
      await existingJob;
      return;
    }

    const job = this.ensureSystemSampleRuntimeInternal(knowledgeBase).finally(
      () => {
        this.runtimeSeedJobs.delete(knowledgeBase.id);
      },
    );

    this.runtimeSeedJobs.set(knowledgeBase.id, job);
    await job;
  }

  private async ensureSystemSampleRuntimeInternal(
    knowledgeBase: KnowledgeBase,
  ): Promise<void> {
    const sampleDataset = toSampleDatasetName(knowledgeBase.sampleDataset);
    if (!sampleDataset) {
      logger.warn(
        `Skip runtime bootstrap for knowledge base ${knowledgeBase.id}: invalid sampleDataset ${knowledgeBase.sampleDataset}`,
      );
      return;
    }

    let deployment = await resolveExistingSampleDeployment(
      knowledgeBase,
      this.deps,
    );
    if (!deployment) {
      deployment = await this.seedSystemSampleDeployment(
        knowledgeBase,
        sampleDataset,
      );
    }

    const snapshot = await ensureSystemSampleSnapshot(
      knowledgeBase,
      deployment,
      this.deps,
    );
    await syncSystemSampleKnowledgeBase(knowledgeBase, snapshot, this.deps);
    await syncRuntimeScopedArtifacts(
      knowledgeBase,
      snapshot,
      deployment,
      this.deps,
    );

    await this.deps.dashboardService.initDashboard(deployment.projectId, {
      knowledgeBaseId: knowledgeBase.id,
      kbSnapshotId: snapshot.id,
      deployHash: deployment.hash,
      createdBy: null,
    });
  }

  private async seedSystemSampleDeployment(
    knowledgeBase: KnowledgeBase,
    sampleDataset: SampleDatasetName,
  ) {
    const dataset = sampleDatasets[sampleDataset.toLowerCase()];
    if (!dataset) {
      throw new Error(`Unknown sample dataset: ${sampleDataset}`);
    }

    const project = await findOrCreateSystemSampleProject(
      knowledgeBase,
      sampleDataset,
      this.deps,
    );
    await this.prepareDuckDBEnvironment(buildInitSql(sampleDataset));
    await this.deps.modelService.deleteAllViewsByProjectId(project.id);
    await this.deps.modelService.deleteAllModelsByProjectId(project.id);

    const compactTables =
      await this.deps.projectService.getProjectConnectionTables(project);
    const tableNames = dataset.tables.map((table) => table.tableName);
    const { models, columns } = await this.createModelsAndColumns({
      projectId: project.id,
      compactTables,
      tableNames,
    });

    await this.deps.modelService.updatePrimaryKeys(project.id, dataset.tables);
    await this.deps.modelService.batchUpdateModelProperties(
      project.id,
      dataset.tables,
    );
    await this.deps.modelService.batchUpdateColumnProperties(
      project.id,
      dataset.tables,
    );

    const relations = getRelations(sampleDataset) || [];
    if (relations.length > 0) {
      await this.deps.modelService.saveRelations(
        this.buildRelationInput(relations, models, columns),
      );
    }

    const updatedProject =
      project.sampleDataset === sampleDataset
        ? project
        : await this.deps.projectRepository.updateOne(project.id, {
            sampleDataset,
          });

    const { manifest } = await this.deps.mdlService.makeCurrentModelMDL(
      updatedProject.id,
    );
    const deployResult = await this.deps.deployService.deploy(
      manifest,
      {
        projectId: updatedProject.id,
        workspaceId: knowledgeBase.workspaceId,
        knowledgeBaseId: knowledgeBase.id,
        kbSnapshotId: null,
        deployHash: null,
        actorUserId: null,
      },
      false,
    );

    if (deployResult.status !== DeployStatusEnum.SUCCESS) {
      throw new Error(
        deployResult.error ||
          `Failed to deploy sample runtime for knowledge base ${knowledgeBase.id}`,
      );
    }

    const deployment =
      (await this.deps.deployService.getLastDeployment(updatedProject.id)) ||
      (await this.deps.deployService.getLastDeploymentByRuntimeIdentity({
        workspaceId: knowledgeBase.workspaceId,
        knowledgeBaseId: knowledgeBase.id,
        kbSnapshotId: null,
        deployHash: null,
        projectId: null,
      }));
    if (!deployment) {
      throw new Error(
        `Sample runtime deployment not found for knowledge base ${knowledgeBase.id}`,
      );
    }

    return deployment;
  }

  private async prepareDuckDBEnvironment(initSql: string): Promise<void> {
    await prepareDuckDBEnvironmentHelper(initSql, this.deps.wrenEngineAdaptor);
  }

  private async createModelsAndColumns(args: {
    projectId: number;
    compactTables: Array<{
      name: string;
      columns: Array<{
        name: string;
        type: string;
        notNull: boolean;
        properties?: Record<string, any>;
        nestedColumns?: any[];
      }>;
      primaryKey?: string;
      properties?: Record<string, any>;
    }>;
    tableNames: string[];
  }): Promise<{ models: Model[]; columns: ModelColumn[] }> {
    return await createModelsAndColumnsHelper({
      ...args,
      deps: this.deps,
    });
  }

  private buildRelationInput(
    relations: Array<{
      fromModelName: string;
      fromColumnName: string;
      toModelName: string;
      toColumnName: string;
      type: RelationType;
      description?: string;
    }>,
    models: Model[],
    columns: ModelColumn[],
  ) {
    return buildRelationInputHelper(relations, models, columns);
  }

  private warmSystemSampleRuntimesInBackground(
    workspaceId: string,
    knowledgeBases: KnowledgeBase[],
    eagerKnowledgeBaseId: string | null,
  ) {
    warmSystemSampleRuntimesInBackground(
      workspaceId,
      knowledgeBases,
      eagerKnowledgeBaseId,
      this.runtimeDeps,
      logger,
      async (knowledgeBase) =>
        await this.ensureSystemSampleRuntime(knowledgeBase),
    );
  }
}
