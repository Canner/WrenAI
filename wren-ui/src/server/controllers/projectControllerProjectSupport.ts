import { DataSource, DataSourceName, IContext, RelationData } from '../types';
import { CompactTable, ProjectData } from '../services';
import { KnowledgeBase, Model, ModelColumn, Project } from '../repositories';
import {
  trim,
  getLogger,
  replaceInvalidReferenceName,
  transformInvalidColumnName,
  handleNestedColumns,
} from '@server/utils';
import { DuckDBPrepareOptions } from '@server/adaptors/wrenEngineAdaptor';
import { PersistedRuntimeIdentity } from '@server/context/runtimeScope';
import { toPersistedRuntimeIdentityPatch } from '@server/utils/persistedRuntimeIdentity';
import { TelemetryEvent } from '../telemetry/telemetry';
import { syncLatestExecutableKnowledgeBaseSnapshot } from '../utils/knowledgeBaseRuntime';
import { SampleDatasetRelationship } from '@server/data';

const logger = getLogger('ProjectController');
logger.level = 'debug';

export const concatInitSqlSupport = (initSql: string, extensions: string[]) => {
  const installExtensions = extensions
    .map((ext) => `INSTALL ${ext};`)
    .join('\n');
  return trim(`${installExtensions}\n${initSql}`);
};

export const buildDuckDbEnvironmentSupport = async (
  ctx: IContext,
  options: {
    initSql: string;
    extensions: string[];
    configurations: Record<string, any>;
  },
): Promise<void> => {
  const { initSql, extensions, configurations } = options;
  const initSqlWithExtensions = concatInitSqlSupport(initSql, extensions);
  await ctx.wrenEngineAdaptor.prepareDuckDB({
    sessionProps: configurations,
    initSql: initSqlWithExtensions,
  } as DuckDBPrepareOptions);
  await ctx.wrenEngineAdaptor.listTables();
  await ctx.wrenEngineAdaptor.patchConfig({
    'wren.datasource.type': 'duckdb',
  });
};

export const createProjectFromConnectionSupport = async ({
  connection,
  ctx,
  resetCurrentProject,
  buildDuckDbEnvironment,
  resolveActiveRuntimeKnowledgeBase,
}: {
  connection: DataSource;
  ctx: IContext;
  resetCurrentProject: (args: { ctx: IContext }) => Promise<unknown>;
  buildDuckDbEnvironment: (
    ctx: IContext,
    options: {
      initSql: string;
      extensions: string[];
      configurations: Record<string, any>;
    },
  ) => Promise<void>;
  resolveActiveRuntimeKnowledgeBase: (
    ctx: IContext,
  ) => Promise<KnowledgeBase | null>;
}): Promise<Project> => {
  const { type, properties } = connection;
  await resetCurrentProject({ ctx });

  const { displayName, ...connectionInfo } = properties;
  const project = await ctx.projectService.createProject({
    displayName,
    type,
    connectionInfo,
  } as ProjectData);
  logger.debug('Project created.');

  logger.debug('Dashboard init...');
  await ctx.dashboardService.initDashboard(project.id, {
    knowledgeBaseId: ctx.runtimeScope?.knowledgeBase?.id || null,
    kbSnapshotId: ctx.runtimeScope?.kbSnapshot?.id || null,
    deployHash: ctx.runtimeScope?.deployHash || null,
    createdBy: ctx.runtimeScope?.userId || null,
  });
  logger.debug('Dashboard created.');

  const eventName = TelemetryEvent.CONNECTION_SAVE_DATA_SOURCE;
  const eventProperties = { connectionType: type };

  try {
    if (type === DataSourceName.DUCKDB) {
      const duckdbConnectionInfo = connectionInfo as {
        initSql?: string;
        extensions?: string[];
        configurations?: Record<string, any>;
      };
      await buildDuckDbEnvironment(ctx, {
        initSql: duckdbConnectionInfo.initSql || '',
        extensions: duckdbConnectionInfo.extensions || [],
        configurations: duckdbConnectionInfo.configurations || {},
      });
    } else {
      await ctx.projectService.getProjectConnectionTables(project);
      const version =
        await ctx.projectService.getProjectConnectionVersion(project);
      await ctx.projectService.updateProject(project.id, { version });
      logger.debug('Connection tables fetched');
    }

    const knowledgeBase = await resolveActiveRuntimeKnowledgeBase(ctx);
    if (knowledgeBase && knowledgeBase.runtimeProjectId !== project.id) {
      await ctx.knowledgeBaseRepository.updateOne(knowledgeBase.id, {
        runtimeProjectId: project.id,
      });
    }

    ctx.telemetry.sendEvent(eventName, eventProperties);
  } catch (err: any) {
    logger.error('Failed to get project tables', JSON.stringify(err, null, 2));
    await ctx.projectRepository.deleteOne(project.id);
    ctx.telemetry.sendEvent(
      eventName,
      { eventProperties, error: err.message },
      err.extensions?.service,
      false,
    );
    throw err;
  }

  return project;
};

export const deployProjectSupport = async ({
  ctx,
  project,
  buildBridgeRuntimeIdentity,
  resolveActiveRuntimeKnowledgeBase,
}: {
  ctx: IContext;
  project: Project;
  buildBridgeRuntimeIdentity: (
    ctx: IContext,
    bridgeProjectId: number,
  ) => PersistedRuntimeIdentity;
  resolveActiveRuntimeKnowledgeBase: (
    ctx: IContext,
  ) => Promise<KnowledgeBase | null>;
}) => {
  const { manifest } = await ctx.mdlService.makeCurrentModelMDL(project.id);
  const deployRes = await ctx.deployService.deploy(
    manifest,
    buildBridgeRuntimeIdentity(ctx, project.id),
    false,
  );

  if (deployRes.status === 'SUCCESS') {
    const knowledgeBase = await resolveActiveRuntimeKnowledgeBase(ctx);
    await syncLatestExecutableKnowledgeBaseSnapshot({
      knowledgeBase,
      knowledgeBaseRepository: ctx.knowledgeBaseRepository,
      kbSnapshotRepository: ctx.kbSnapshotRepository,
      deployLogRepository: ctx.deployRepository,
      deployService: ctx.deployService,
      modelRepository: ctx.modelRepository,
      relationRepository: ctx.relationRepository,
      viewRepository: ctx.viewRepository,
    });
  }

  return deployRes;
};

export const buildRelationInputSupport = (
  relations: SampleDatasetRelationship[],
  models: Model[],
  columns: ModelColumn[],
): RelationData[] =>
  relations.map((relation) => {
    const { fromModelName, fromColumnName, toModelName, toColumnName, type } =
      relation;
    const fromModelId = models.find(
      (model) => model.sourceTableName === fromModelName,
    )?.id;
    const toModelId = models.find(
      (model) => model.sourceTableName === toModelName,
    )?.id;
    if (!fromModelId || !toModelId) {
      throw new Error(
        `Model not found, fromModelName "${fromModelName}" to toModelName: "${toModelName}"`,
      );
    }

    const fromColumnId = columns.find(
      (column) =>
        column.referenceName === fromColumnName &&
        column.modelId === fromModelId,
    )?.id;
    const toColumnId = columns.find(
      (column) =>
        column.referenceName === toColumnName && column.modelId === toModelId,
    )?.id;
    if (!fromColumnId || !toColumnId) {
      throw new Error(
        `Column not found fromColumnName: ${fromColumnName} toColumnName: ${toColumnName}`,
      );
    }

    return {
      fromModelId,
      fromColumnId,
      toModelId,
      toColumnId,
      type,
      description: relation.description,
    } as RelationData;
  });

export const ensureModelsBelongToActiveRuntimeSupport = async ({
  ctx,
  modelIds,
  projectId,
  getCurrentPersistedRuntimeIdentity,
}: {
  ctx: IContext;
  modelIds: number[];
  projectId: number;
  getCurrentPersistedRuntimeIdentity: (
    ctx: IContext,
  ) => PersistedRuntimeIdentity | null;
}) => {
  const uniqueModelIds = [...new Set(modelIds)];
  const runtimeIdentity = getCurrentPersistedRuntimeIdentity(ctx);
  const models = runtimeIdentity
    ? await ctx.modelService.getModelsByRuntimeIdentity(
        runtimeIdentity,
        uniqueModelIds,
      )
    : await ctx.modelRepository.findAllByIds(uniqueModelIds);

  if (
    models.length !== uniqueModelIds.length ||
    (!runtimeIdentity && models.some((model) => model.projectId !== projectId))
  ) {
    throw new Error('Relation model not found in active project');
  }
};

export const overwriteModelsAndColumnsSupport = async ({
  tables,
  ctx,
  project,
  getCurrentPersistedRuntimeIdentity,
}: {
  tables: string[];
  ctx: IContext;
  project: Project;
  getCurrentPersistedRuntimeIdentity: (
    ctx: IContext,
  ) => PersistedRuntimeIdentity | null;
}) => {
  await ctx.modelService.deleteAllModelsByProjectId(project.id);

  const compactTables: CompactTable[] =
    await ctx.projectService.getProjectConnectionTables(project);
  const selectedTables = compactTables.filter((table) =>
    tables.includes(table.name),
  );
  const runtimePatch = toPersistedRuntimeIdentityPatch({
    ...getCurrentPersistedRuntimeIdentity(ctx),
    projectId: null,
  });

  const modelValues = selectedTables.map((table) => {
    const properties = table?.properties;
    return {
      ...runtimePatch,
      projectId: project.id,
      displayName: table.name,
      referenceName: replaceInvalidReferenceName(table.name),
      sourceTableName: table.name,
      cached: false,
      refreshTime: null,
      properties: properties ? JSON.stringify(properties) : null,
    } as Partial<Model>;
  });
  const models = await ctx.modelRepository.createMany(modelValues);

  const columnValues = selectedTables.flatMap((table) => {
    const primaryKey = table.primaryKey;
    const model = models.find((item) => item.sourceTableName === table.name);
    if (!model) {
      return [];
    }
    return table.columns.map(
      (column) =>
        ({
          modelId: model.id,
          isCalculated: false,
          displayName: column.name,
          referenceName: transformInvalidColumnName(column.name),
          sourceColumnName: column.name,
          type: column.type || 'string',
          notNull: column.notNull || false,
          isPk: primaryKey === column.name,
          properties: column.properties
            ? JSON.stringify(column.properties)
            : null,
        }) as Partial<ModelColumn>,
    );
  });
  const columns = await ctx.modelColumnRepository.createMany(columnValues);

  const compactColumns = selectedTables.flatMap((table) => table.columns);
  const nestedColumnValues = compactColumns.flatMap((compactColumn) => {
    const column = columns.find(
      (item) => item.sourceColumnName === compactColumn.name,
    );
    if (!column) {
      return [];
    }
    return handleNestedColumns(compactColumn, {
      modelId: column.modelId,
      columnId: column.id,
      sourceColumnName: column.sourceColumnName,
    });
  });
  await ctx.modelNestedColumnRepository.createMany(nestedColumnValues);

  return { models, columns };
};
