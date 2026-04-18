import crypto from 'crypto';
import { Knex } from 'knex';
import {
  Deploy,
  IDeployLogRepository,
  DeployStatusEnum,
  IKnowledgeBaseRepository,
  IKBSnapshotRepository,
  IModelColumnRepository,
  IModelNestedColumnRepository,
  IModelRepository,
  IProjectRepository,
  IRelationRepository,
  IWorkspaceRepository,
  KnowledgeBase,
  KBSnapshot,
  Model,
  ModelColumn,
  Workspace,
} from '../repositories';
import {
  DEFAULT_WORKSPACE_NAME,
  DEFAULT_WORKSPACE_SLUG,
  KNOWLEDGE_BASE_KINDS,
  SYSTEM_SAMPLE_KNOWLEDGE_BASES,
  WORKSPACE_KINDS,
} from '@/utils/workspaceGovernance';
import {
  buildInitSql,
  getRelations,
  sampleDatasets,
  SampleDatasetName,
} from '@server/data';
import { DataSourceName, RelationData, RelationType } from '../types';
import {
  getLogger,
  handleNestedColumns,
  replaceInvalidReferenceName,
  transformInvalidColumnName,
} from '@server/utils';
import {
  DuckDBPrepareOptions,
  IWrenEngineAdaptor,
} from '@server/adaptors/wrenEngineAdaptor';
import { IDashboardService } from './dashboardService';
import { IDeployService } from './deployService';
import { IMDLService } from './mdlService';
import { IModelService } from './modelService';
import { IProjectService } from './projectService';

const logger = getLogger('WorkspaceBootstrapService');
logger.level = 'debug';

const SYSTEM_SAMPLE_SNAPSHOT_KEY = 'system-sample-default';
const SYSTEM_SAMPLE_SNAPSHOT_STATUS = 'active';
const SYSTEM_SAMPLE_PROJECT_PREFIX = '[system-sample]';

const SAMPLE_DATASET_NAMES = new Set<string>(Object.values(SampleDatasetName));
const PRIMARY_SYSTEM_SAMPLE_DATASET = SampleDatasetName.ECOMMERCE;

const toSampleDatasetName = (
  value?: string | null,
): SampleDatasetName | null => {
  if (!value || !SAMPLE_DATASET_NAMES.has(value)) {
    return null;
  }

  return value as SampleDatasetName;
};

export interface IWorkspaceBootstrapService {
  findDefaultWorkspace(options?: {
    tx?: Knex.Transaction;
  }): Promise<Workspace | null>;
  ensureDefaultWorkspaceWithSamples(options?: {
    tx?: Knex.Transaction;
    runtimeSeedMode?: SampleRuntimeSeedMode;
  }): Promise<Workspace>;
  ensureDefaultWorkspaceSampleRuntime(options: {
    sampleDataset: SampleDatasetName;
    tx?: Knex.Transaction;
  }): Promise<{
    workspace: Workspace;
    knowledgeBase: KnowledgeBase;
  }>;
}

export type SampleRuntimeSeedMode =
  | 'all'
  | 'default_only'
  | 'background_all'
  | 'metadata_only';

export class WorkspaceBootstrapService implements IWorkspaceBootstrapService {
  private readonly workspaceRepository: IWorkspaceRepository;
  private readonly knowledgeBaseRepository: IKnowledgeBaseRepository;
  private readonly kbSnapshotRepository: IKBSnapshotRepository;
  private readonly projectRepository: IProjectRepository;
  private readonly projectService: IProjectService;
  private readonly modelService: IModelService;
  private readonly modelRepository: IModelRepository;
  private readonly modelColumnRepository: IModelColumnRepository;
  private readonly modelNestedColumnRepository: IModelNestedColumnRepository;
  private readonly relationRepository: IRelationRepository;
  private readonly deployService: IDeployService;
  private readonly deployLogRepository: IDeployLogRepository;
  private readonly mdlService: IMDLService;
  private readonly dashboardService: IDashboardService;
  private readonly wrenEngineAdaptor: IWrenEngineAdaptor;
  private readonly runtimeSeedJobs = new Map<string, Promise<void>>();
  private readonly workspaceWarmupJobs = new Map<string, Promise<void>>();

  constructor({
    workspaceRepository,
    knowledgeBaseRepository,
    kbSnapshotRepository,
    projectRepository,
    projectService,
    modelService,
    modelRepository,
    modelColumnRepository,
    modelNestedColumnRepository,
    relationRepository,
    deployService,
    deployLogRepository,
    mdlService,
    dashboardService,
    wrenEngineAdaptor,
  }: {
    workspaceRepository: IWorkspaceRepository;
    knowledgeBaseRepository: IKnowledgeBaseRepository;
    kbSnapshotRepository: IKBSnapshotRepository;
    projectRepository: IProjectRepository;
    projectService: IProjectService;
    modelService: IModelService;
    modelRepository: IModelRepository;
    modelColumnRepository: IModelColumnRepository;
    modelNestedColumnRepository: IModelNestedColumnRepository;
    relationRepository: IRelationRepository;
    deployService: IDeployService;
    deployLogRepository: IDeployLogRepository;
    mdlService: IMDLService;
    dashboardService: IDashboardService;
    wrenEngineAdaptor: IWrenEngineAdaptor;
  }) {
    this.workspaceRepository = workspaceRepository;
    this.knowledgeBaseRepository = knowledgeBaseRepository;
    this.kbSnapshotRepository = kbSnapshotRepository;
    this.projectRepository = projectRepository;
    this.projectService = projectService;
    this.modelService = modelService;
    this.modelRepository = modelRepository;
    this.modelColumnRepository = modelColumnRepository;
    this.modelNestedColumnRepository = modelNestedColumnRepository;
    this.relationRepository = relationRepository;
    this.deployService = deployService;
    this.deployLogRepository = deployLogRepository;
    this.mdlService = mdlService;
    this.dashboardService = dashboardService;
    this.wrenEngineAdaptor = wrenEngineAdaptor;
  }

  public async findDefaultWorkspace({
    tx,
  }: {
    tx?: Knex.Transaction;
  } = {}): Promise<Workspace | null> {
    return await this.workspaceRepository.findOneBy(
      {
        kind: WORKSPACE_KINDS.DEFAULT,
      },
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
    let workspace = await this.findDefaultWorkspace({ tx });

    if (!workspace) {
      workspace = await this.workspaceRepository.createOne(
        {
          id: crypto.randomUUID(),
          slug: DEFAULT_WORKSPACE_SLUG,
          name: DEFAULT_WORKSPACE_NAME,
          kind: WORKSPACE_KINDS.DEFAULT,
          status: 'active',
          createdBy: null,
          settings: null,
        },
        tx ? { tx } : undefined,
      );
    }

    const knowledgeBases = await this.ensureSystemSampleKnowledgeBases(
      workspace,
      {
        tx,
      },
    );

    const effectiveSeedMode: SampleRuntimeSeedMode = tx
      ? 'metadata_only'
      : runtimeSeedMode || 'all';

    if (effectiveSeedMode === 'default_only') {
      const primaryKnowledgeBase =
        this.pickPrimarySystemSampleKnowledgeBase(knowledgeBases);
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
      for (const knowledgeBase of this.sortSystemSampleKnowledgeBasesForSeeding(
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

    const knowledgeBase = await this.knowledgeBaseRepository.findOneBy(
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

    return {
      workspace,
      knowledgeBase,
    };
  }

  private async ensureSystemSampleKnowledgeBases(
    workspace: Workspace,
    {
      tx,
    }: {
      tx?: Knex.Transaction;
    },
  ): Promise<KnowledgeBase[]> {
    const ensuredKnowledgeBases: KnowledgeBase[] = [];

    for (const sample of SYSTEM_SAMPLE_KNOWLEDGE_BASES) {
      const existing =
        (await this.knowledgeBaseRepository.findOneBy(
          {
            workspaceId: workspace.id,
            slug: sample.slug,
          },
          tx ? { tx } : undefined,
        )) ||
        (await this.knowledgeBaseRepository.findOneBy(
          {
            workspaceId: workspace.id,
            sampleDataset: sample.sampleDataset,
          },
          tx ? { tx } : undefined,
        ));

      const desiredDescription = `${sample.name} 系统样例知识库`;

      if (existing) {
        const shouldUpdate =
          existing.kind !== KNOWLEDGE_BASE_KINDS.SYSTEM_SAMPLE ||
          existing.sampleDataset !== sample.sampleDataset ||
          existing.slug !== sample.slug ||
          existing.name !== sample.name ||
          existing.description !== desiredDescription ||
          existing.archivedAt != null;

        if (shouldUpdate) {
          ensuredKnowledgeBases.push(
            await this.knowledgeBaseRepository.updateOne(
              existing.id,
              {
                slug: sample.slug,
                name: sample.name,
                kind: KNOWLEDGE_BASE_KINDS.SYSTEM_SAMPLE,
                description: desiredDescription,
                sampleDataset: sample.sampleDataset,
                archivedAt: null,
              },
              tx ? { tx } : undefined,
            ),
          );
        } else {
          ensuredKnowledgeBases.push(existing);
        }
        continue;
      }

      ensuredKnowledgeBases.push(
        await this.knowledgeBaseRepository.createOne(
          {
            id: crypto.randomUUID(),
            workspaceId: workspace.id,
            slug: sample.slug,
            name: sample.name,
            kind: KNOWLEDGE_BASE_KINDS.SYSTEM_SAMPLE,
            description: desiredDescription,
            defaultKbSnapshotId: null,
            primaryConnectorId: null,
            language: null,
            sampleDataset: sample.sampleDataset,
            recommendationQueryId: null,
            recommendationStatus: null,
            recommendationQuestions: null,
            recommendationError: null,
            createdBy: null,
            archivedAt: null,
          },
          tx ? { tx } : undefined,
        ),
      );
    }

    return ensuredKnowledgeBases;
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

    let deployment = await this.resolveExistingSampleDeployment(knowledgeBase);
    if (!deployment) {
      deployment = await this.seedSystemSampleDeployment(
        knowledgeBase,
        sampleDataset,
      );
    }

    const snapshot = await this.ensureSystemSampleSnapshot(
      knowledgeBase,
      deployment,
    );

    await this.syncSystemSampleKnowledgeBase(
      knowledgeBase,
      snapshot,
      sampleDataset,
    );
    await this.syncRuntimeScopedArtifacts(knowledgeBase, snapshot, deployment);

    await this.dashboardService.initDashboard(deployment.projectId, {
      knowledgeBaseId: knowledgeBase.id,
      kbSnapshotId: snapshot.id,
      deployHash: deployment.hash,
      createdBy: null,
    });
  }

  private async resolveExistingSampleDeployment(
    knowledgeBase: KnowledgeBase,
  ): Promise<Deploy | null> {
    const snapshot = await this.findSystemSampleSnapshot(knowledgeBase);

    if (snapshot?.deployHash) {
      const deployment =
        await this.deployService.getDeploymentByRuntimeIdentity({
          workspaceId: knowledgeBase.workspaceId,
          knowledgeBaseId: knowledgeBase.id,
          kbSnapshotId: snapshot.id,
          deployHash: snapshot.deployHash,
          projectId: null,
        });
      if (deployment && (await this.projectExists(deployment.projectId))) {
        return deployment;
      }
    }

    const fallbackDeployment =
      await this.deployService.getLastDeploymentByRuntimeIdentity({
        workspaceId: knowledgeBase.workspaceId,
        knowledgeBaseId: knowledgeBase.id,
        kbSnapshotId: snapshot?.id || null,
        deployHash: null,
        projectId: null,
      });

    if (!fallbackDeployment) {
      return null;
    }

    return (await this.projectExists(fallbackDeployment.projectId))
      ? fallbackDeployment
      : null;
  }

  private async seedSystemSampleDeployment(
    knowledgeBase: KnowledgeBase,
    sampleDataset: SampleDatasetName,
  ): Promise<Deploy> {
    const dataset = sampleDatasets[sampleDataset.toLowerCase()];
    if (!dataset) {
      throw new Error(`Unknown sample dataset: ${sampleDataset}`);
    }

    const project = await this.findOrCreateSystemSampleProject(
      knowledgeBase,
      sampleDataset,
    );
    await this.prepareDuckDBEnvironment(buildInitSql(sampleDataset));
    await this.modelService.deleteAllViewsByProjectId(project.id);
    await this.modelService.deleteAllModelsByProjectId(project.id);

    const compactTables =
      await this.projectService.getProjectConnectionTables(project);
    const tableNames = dataset.tables.map((table) => table.tableName);
    const { models, columns } = await this.createModelsAndColumns({
      projectId: project.id,
      compactTables,
      tableNames,
    });

    await this.modelService.updatePrimaryKeys(project.id, dataset.tables);
    await this.modelService.batchUpdateModelProperties(
      project.id,
      dataset.tables,
    );
    await this.modelService.batchUpdateColumnProperties(
      project.id,
      dataset.tables,
    );

    const relations = getRelations(sampleDataset) || [];
    if (relations.length > 0) {
      await this.modelService.saveRelations(
        this.buildRelationInput(relations, models, columns),
      );
    }

    const updatedProject =
      project.sampleDataset === sampleDataset
        ? project
        : await this.projectRepository.updateOne(project.id, {
            sampleDataset,
          });

    const { manifest } = await this.mdlService.makeCurrentModelMDL(
      updatedProject.id,
    );
    const deployResult = await this.deployService.deploy(
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
      (await this.deployService.getLastDeployment(updatedProject.id)) ||
      (await this.deployService.getLastDeploymentByRuntimeIdentity({
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

  private async findOrCreateSystemSampleProject(
    knowledgeBase: KnowledgeBase,
    sampleDataset: SampleDatasetName,
  ) {
    const displayName = this.buildSystemSampleProjectDisplayName(
      knowledgeBase,
      sampleDataset,
    );

    const existing = await this.projectRepository.findOneBy({ displayName });
    if (existing) {
      if (existing.sampleDataset !== sampleDataset) {
        return await this.projectRepository.updateOne(existing.id, {
          sampleDataset,
        });
      }
      return existing;
    }

    return await this.projectService.createProject({
      displayName,
      type: DataSourceName.DUCKDB,
      connectionInfo: {
        initSql: buildInitSql(sampleDataset),
        extensions: [],
        configurations: {},
      },
    });
  }

  private buildSystemSampleProjectDisplayName(
    knowledgeBase: KnowledgeBase,
    sampleDataset: SampleDatasetName,
  ) {
    return `${SYSTEM_SAMPLE_PROJECT_PREFIX} ${knowledgeBase.slug} ${sampleDataset}`;
  }

  private async prepareDuckDBEnvironment(initSql: string): Promise<void> {
    await this.wrenEngineAdaptor.prepareDuckDB({
      initSql,
      sessionProps: {},
    } as DuckDBPrepareOptions);
    await this.wrenEngineAdaptor.listTables();
    await this.wrenEngineAdaptor.patchConfig({
      'wren.datasource.type': 'duckdb',
    });
  }

  private async createModelsAndColumns({
    projectId,
    compactTables,
    tableNames,
  }: {
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
    const selectedTables = compactTables.filter((table) =>
      tableNames.includes(table.name),
    );

    const modelValues = selectedTables.map((table) => ({
      projectId,
      displayName: table.name,
      referenceName: replaceInvalidReferenceName(table.name),
      sourceTableName: table.name,
      cached: false,
      refreshTime: null,
      properties: table.properties ? JSON.stringify(table.properties) : null,
    }));

    const models = await this.modelRepository.createMany(modelValues);

    const columnValues = selectedTables.flatMap((table) => {
      const model = models.find(
        (candidate) => candidate.sourceTableName === table.name,
      );
      if (!model) {
        throw new Error(`Model not found after createMany: ${table.name}`);
      }

      return table.columns.map((column) => ({
        modelId: model.id,
        isCalculated: false,
        displayName: column.name,
        referenceName: transformInvalidColumnName(column.name),
        sourceColumnName: column.name,
        type: column.type || 'string',
        notNull: column.notNull || false,
        isPk: table.primaryKey === column.name,
        properties: column.properties
          ? JSON.stringify(column.properties)
          : undefined,
      }));
    });

    const columns = await this.modelColumnRepository.createMany(columnValues);

    const nestedColumnValues = selectedTables.flatMap((table) =>
      table.columns.flatMap((compactColumn) => {
        const model = models.find(
          (candidate) => candidate.sourceTableName === table.name,
        );
        if (!model) {
          return [];
        }

        const column = columns.find(
          (candidate) =>
            candidate.modelId === model.id &&
            candidate.sourceColumnName === compactColumn.name,
        );
        if (!column) {
          return [];
        }

        return handleNestedColumns(compactColumn, {
          modelId: column.modelId,
          columnId: column.id,
          sourceColumnName: column.sourceColumnName,
        });
      }),
    );

    if (nestedColumnValues.length > 0) {
      await this.modelNestedColumnRepository.createMany(nestedColumnValues);
    }

    return { models, columns };
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
  ): RelationData[] {
    return relations.map((relation) => {
      const fromModelId = models.find(
        (model) => model.sourceTableName === relation.fromModelName,
      )?.id;
      const toModelId = models.find(
        (model) => model.sourceTableName === relation.toModelName,
      )?.id;

      if (!fromModelId || !toModelId) {
        throw new Error(
          `Model not found for relation ${relation.fromModelName} -> ${relation.toModelName}`,
        );
      }

      const fromColumnId = columns.find(
        (column) =>
          column.modelId === fromModelId &&
          column.referenceName === relation.fromColumnName,
      )?.id;
      const toColumnId = columns.find(
        (column) =>
          column.modelId === toModelId &&
          column.referenceName === relation.toColumnName,
      )?.id;

      if (!fromColumnId || !toColumnId) {
        throw new Error(
          `Column not found for relation ${relation.fromModelName}.${relation.fromColumnName} -> ${relation.toModelName}.${relation.toColumnName}`,
        );
      }

      return {
        fromModelId,
        fromColumnId,
        toModelId,
        toColumnId,
        type: relation.type,
        description: relation.description,
      } as RelationData;
    });
  }

  private async ensureSystemSampleSnapshot(
    knowledgeBase: KnowledgeBase,
    deployment: Deploy,
  ): Promise<KBSnapshot> {
    const snapshot = await this.findSystemSampleSnapshot(knowledgeBase);
    const displayName = `${knowledgeBase.name} 默认快照`;

    const upsertedSnapshot = snapshot
      ? await this.kbSnapshotRepository.updateOne(snapshot.id, {
          displayName,
          deployHash: deployment.hash,
          status: SYSTEM_SAMPLE_SNAPSHOT_STATUS,
          manifestRef: null,
        })
      : await this.kbSnapshotRepository.createOne({
          id: crypto.randomUUID(),
          knowledgeBaseId: knowledgeBase.id,
          snapshotKey: SYSTEM_SAMPLE_SNAPSHOT_KEY,
          displayName,
          environment: null,
          versionLabel: null,
          deployHash: deployment.hash,
          manifestRef: null,
          status: SYSTEM_SAMPLE_SNAPSHOT_STATUS,
        });

    if (deployment.kbSnapshotId !== upsertedSnapshot.id) {
      await this.deployLogRepository.updateOne(deployment.id, {
        kbSnapshotId: upsertedSnapshot.id,
      });
    }

    return upsertedSnapshot;
  }

  private async syncSystemSampleKnowledgeBase(
    knowledgeBase: KnowledgeBase,
    snapshot: KBSnapshot,
    _sampleDataset: SampleDatasetName,
  ): Promise<void> {
    const recommendationQuestions = null;
    const shouldUpdate =
      knowledgeBase.defaultKbSnapshotId !== snapshot.id ||
      knowledgeBase.primaryConnectorId !== null ||
      knowledgeBase.recommendationQueryId !== null ||
      knowledgeBase.recommendationStatus !== null ||
      JSON.stringify(knowledgeBase.recommendationQuestions || null) !==
        JSON.stringify(recommendationQuestions) ||
      knowledgeBase.recommendationError !== null;

    if (!shouldUpdate) {
      return;
    }

    await this.knowledgeBaseRepository.updateOne(knowledgeBase.id, {
      defaultKbSnapshotId: snapshot.id,
      primaryConnectorId: null,
      recommendationQueryId: null,
      recommendationStatus: null,
      recommendationQuestions,
      recommendationError: null,
    });
  }

  private async syncRuntimeScopedArtifacts(
    knowledgeBase: KnowledgeBase,
    snapshot: KBSnapshot,
    deployment: Deploy,
  ): Promise<void> {
    const models = await this.modelRepository.findAllBy({
      projectId: deployment.projectId,
    });
    for (const model of models) {
      const shouldUpdate =
        model.workspaceId !== knowledgeBase.workspaceId ||
        model.knowledgeBaseId !== knowledgeBase.id ||
        model.kbSnapshotId !== snapshot.id ||
        model.deployHash !== deployment.hash;

      if (!shouldUpdate) {
        continue;
      }

      await this.modelRepository.updateOne(model.id, {
        workspaceId: knowledgeBase.workspaceId,
        knowledgeBaseId: knowledgeBase.id,
        kbSnapshotId: snapshot.id,
        deployHash: deployment.hash,
        actorUserId: null,
      });
    }

    const relations = await this.relationRepository.findAllBy({
      projectId: deployment.projectId,
    });
    for (const relation of relations) {
      const shouldUpdate =
        relation.workspaceId !== knowledgeBase.workspaceId ||
        relation.knowledgeBaseId !== knowledgeBase.id ||
        relation.kbSnapshotId !== snapshot.id ||
        relation.deployHash !== deployment.hash;

      if (!shouldUpdate) {
        continue;
      }

      await this.relationRepository.updateOne(relation.id, {
        workspaceId: knowledgeBase.workspaceId,
        knowledgeBaseId: knowledgeBase.id,
        kbSnapshotId: snapshot.id,
        deployHash: deployment.hash,
        actorUserId: null,
      });
    }
  }

  private async findSystemSampleSnapshot(
    knowledgeBase: KnowledgeBase,
  ): Promise<KBSnapshot | null> {
    return await this.kbSnapshotRepository.findOneBy({
      knowledgeBaseId: knowledgeBase.id,
      snapshotKey: SYSTEM_SAMPLE_SNAPSHOT_KEY,
    });
  }

  private pickPrimarySystemSampleKnowledgeBase(
    knowledgeBases: KnowledgeBase[],
  ): KnowledgeBase | null {
    if (knowledgeBases.length === 0) {
      return null;
    }

    return (
      knowledgeBases.find(
        (knowledgeBase) =>
          knowledgeBase.sampleDataset === PRIMARY_SYSTEM_SAMPLE_DATASET,
      ) || this.sortSystemSampleKnowledgeBasesForSeeding(knowledgeBases)[0]
    );
  }

  private sortSystemSampleKnowledgeBasesForSeeding(
    knowledgeBases: KnowledgeBase[],
  ) {
    return [...knowledgeBases].sort((left, right) => {
      const leftPriority =
        left.sampleDataset === PRIMARY_SYSTEM_SAMPLE_DATASET ? 0 : 1;
      const rightPriority =
        right.sampleDataset === PRIMARY_SYSTEM_SAMPLE_DATASET ? 0 : 1;

      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }

      return String(left.name || '').localeCompare(String(right.name || ''));
    });
  }

  private warmSystemSampleRuntimesInBackground(
    workspaceId: string,
    knowledgeBases: KnowledgeBase[],
    eagerKnowledgeBaseId: string | null,
  ) {
    const remainingKnowledgeBases =
      this.sortSystemSampleKnowledgeBasesForSeeding(knowledgeBases).filter(
        (knowledgeBase) => knowledgeBase.id !== eagerKnowledgeBaseId,
      );

    if (
      remainingKnowledgeBases.length === 0 ||
      this.workspaceWarmupJobs.has(workspaceId)
    ) {
      return;
    }

    const job = (async () => {
      for (const knowledgeBase of remainingKnowledgeBases) {
        try {
          await this.ensureSystemSampleRuntime(knowledgeBase);
        } catch (error: any) {
          logger.warn(
            `Background bootstrap skipped for sample knowledge base ${knowledgeBase.id}: ${
              error?.message || error
            }`,
          );
        }
      }
    })().finally(() => {
      this.workspaceWarmupJobs.delete(workspaceId);
    });

    this.workspaceWarmupJobs.set(workspaceId, job);
  }

  private async projectExists(projectId: number): Promise<boolean> {
    if (!projectId) {
      return false;
    }

    const project = await this.projectRepository.findOneBy({ id: projectId });
    return Boolean(project);
  }
}
