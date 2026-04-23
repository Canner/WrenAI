import crypto from 'crypto';
import { Knex } from 'knex';
import {
  DeployStatusEnum,
  KnowledgeBase,
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
  handleNestedColumns,
  replaceInvalidReferenceName,
  transformInvalidColumnName,
} from '@server/utils';
import {
  DuckDBPrepareOptions,
  IWrenEngineAdaptor,
} from '@server/adaptors/wrenEngineAdaptor';
import { WorkspaceBootstrapServiceDependencies } from './workspaceBootstrapServiceTypes';

export const SYSTEM_SAMPLE_SNAPSHOT_KEY = 'system-sample-default';
export const SYSTEM_SAMPLE_SNAPSHOT_STATUS = 'active';
export const SYSTEM_SAMPLE_PROJECT_PREFIX = '[system-sample]';

const SAMPLE_DATASET_NAMES = new Set<string>(Object.values(SampleDatasetName));

export const toSampleDatasetName = (
  value?: string | null,
): SampleDatasetName | null => {
  if (!value || !SAMPLE_DATASET_NAMES.has(value)) {
    return null;
  }

  return value as SampleDatasetName;
};

export const ensureDefaultWorkspaceRecord = async ({
  tx,
  workspaceRepository,
}: {
  tx?: Knex.Transaction;
  workspaceRepository: WorkspaceBootstrapServiceDependencies['workspaceRepository'];
}): Promise<Workspace> => {
  let workspace = await workspaceRepository.findOneBy(
    {
      kind: WORKSPACE_KINDS.DEFAULT,
    },
    tx ? { tx } : undefined,
  );

  if (!workspace) {
    workspace = await workspaceRepository.createOne(
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

  return workspace;
};

export const ensureSystemSampleKnowledgeBases = async (
  workspace: Workspace,
  deps: WorkspaceBootstrapServiceDependencies,
  {
    tx,
  }: {
    tx?: Knex.Transaction;
  } = {},
): Promise<KnowledgeBase[]> => {
  const ensuredKnowledgeBases: KnowledgeBase[] = [];

  for (const sample of SYSTEM_SAMPLE_KNOWLEDGE_BASES) {
    const existing =
      (await deps.knowledgeBaseRepository.findOneBy(
        {
          workspaceId: workspace.id,
          slug: sample.slug,
        },
        tx ? { tx } : undefined,
      )) ||
      (await deps.knowledgeBaseRepository.findOneBy(
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
          await deps.knowledgeBaseRepository.updateOne(
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
      await deps.knowledgeBaseRepository.createOne(
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
          createdBy: null,
          archivedAt: null,
        },
        tx ? { tx } : undefined,
      ),
    );
  }

  return ensuredKnowledgeBases;
};

export const seedSystemSampleDeployment = async (
  knowledgeBase: KnowledgeBase,
  sampleDataset: SampleDatasetName,
  deps: WorkspaceBootstrapServiceDependencies,
) => {
  const dataset = sampleDatasets[sampleDataset.toLowerCase()];
  if (!dataset) {
    throw new Error(`Unknown sample dataset: ${sampleDataset}`);
  }

  const project = await findOrCreateSystemSampleProject(
    knowledgeBase,
    sampleDataset,
    deps,
  );
  await prepareDuckDBEnvironment(
    buildInitSql(sampleDataset),
    deps.wrenEngineAdaptor,
  );
  await deps.modelService.deleteAllViewsByProjectId(project.id);
  await deps.modelService.deleteAllModelsByProjectId(project.id);

  const compactTables =
    await deps.projectService.getProjectConnectionTables(project);
  const tableNames = dataset.tables.map((table) => table.tableName);
  const { models, columns } = await createModelsAndColumns({
    projectId: project.id,
    compactTables,
    tableNames,
    deps,
  });

  await deps.modelService.updatePrimaryKeys(project.id, dataset.tables);
  await deps.modelService.batchUpdateModelProperties(
    project.id,
    dataset.tables,
  );
  await deps.modelService.batchUpdateColumnProperties(
    project.id,
    dataset.tables,
  );

  const relations = getRelations(sampleDataset) || [];
  if (relations.length > 0) {
    await deps.modelService.saveRelations(
      buildRelationInput(relations, models, columns),
    );
  }

  const updatedProject =
    project.sampleDataset === sampleDataset
      ? project
      : await deps.projectRepository.updateOne(project.id, {
          sampleDataset,
        });

  const { manifest } = await deps.mdlService.makeCurrentModelMDL(
    updatedProject.id,
  );
  const deployResult = await deps.deployService.deploy(
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
    (await deps.deployService.getLastDeployment(updatedProject.id)) ||
    (await deps.deployService.getLastDeploymentByRuntimeIdentity({
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
};

export const findOrCreateSystemSampleProject = async (
  knowledgeBase: KnowledgeBase,
  sampleDataset: SampleDatasetName,
  deps: WorkspaceBootstrapServiceDependencies,
) => {
  const displayName = buildSystemSampleProjectDisplayName(
    knowledgeBase,
    sampleDataset,
  );

  const existing = await deps.projectRepository.findOneBy({ displayName });
  if (existing) {
    if (existing.sampleDataset !== sampleDataset) {
      return await deps.projectRepository.updateOne(existing.id, {
        sampleDataset,
      });
    }
    return existing;
  }

  return await deps.projectService.createProject({
    displayName,
    type: DataSourceName.DUCKDB,
    connectionInfo: {
      initSql: buildInitSql(sampleDataset),
      extensions: [],
      configurations: {},
    },
  });
};

export const buildSystemSampleProjectDisplayName = (
  knowledgeBase: KnowledgeBase,
  sampleDataset: SampleDatasetName,
) => `${SYSTEM_SAMPLE_PROJECT_PREFIX} ${knowledgeBase.slug} ${sampleDataset}`;

export const prepareDuckDBEnvironment = async (
  initSql: string,
  wrenEngineAdaptor: IWrenEngineAdaptor,
): Promise<void> => {
  await wrenEngineAdaptor.prepareDuckDB({
    initSql,
    sessionProps: {},
  } as DuckDBPrepareOptions);
  await wrenEngineAdaptor.listTables();
  await wrenEngineAdaptor.patchConfig({
    'wren.datasource.type': 'duckdb',
  });
};

export const createModelsAndColumns = async ({
  projectId,
  compactTables,
  tableNames,
  deps,
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
  deps: WorkspaceBootstrapServiceDependencies;
}): Promise<{ models: Model[]; columns: ModelColumn[] }> => {
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

  const models = await deps.modelRepository.createMany(modelValues);

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

  const columns = await deps.modelColumnRepository.createMany(columnValues);

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
    await deps.modelNestedColumnRepository.createMany(nestedColumnValues);
  }

  return { models, columns };
};

export const buildRelationInput = (
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
): RelationData[] =>
  relations.map((relation) => {
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
