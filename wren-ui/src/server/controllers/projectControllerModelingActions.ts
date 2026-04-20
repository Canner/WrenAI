import { DataSourceName } from '../types';
import {
  buildInitSql,
  getRelations,
  sampleDatasets,
  SampleDatasetName,
} from '@server/data';
import { snakeCase } from 'lodash';
import { TelemetryEvent } from '../telemetry/telemetry';
import ConnectionSchemaDetector, {
  SchemaChangeType,
} from '@server/managers/connectionSchemaDetector';
import { ApiError } from '@server/utils/apiUtils';
import { getLogger } from '@server/utils';
import {
  canImportSampleDatasetInWorkspace,
  getSampleDatasetImportRestrictionReason,
} from '@/utils/workspaceGovernance';
import {
  ProjectControllerMutationDeps,
  SaveRelationsArgs,
  SaveTablesArgs,
  StartSampleDatasetArgs,
  TriggerConnectionDetectionArgs,
} from './projectControllerMutationTypes';

const logger = getLogger('ProjectController');

export const startSampleDatasetAction = async ({
  args,
  ctx,
  deps,
}: StartSampleDatasetArgs & {
  deps: Pick<
    ProjectControllerMutationDeps,
    | 'assertKnowledgeBaseWriteAccess'
    | 'createProjectFromConnection'
    | 'overwriteModelsAndColumns'
    | 'buildRelationInput'
    | 'deploy'
    | 'recordKnowledgeBaseWriteAudit'
  >;
}) => {
  const workspaceKind = ctx.runtimeScope?.workspace?.kind || null;
  if (!canImportSampleDatasetInWorkspace(workspaceKind)) {
    throw new ApiError(
      getSampleDatasetImportRestrictionReason(workspaceKind) ||
        '当前工作区不支持导入样例数据',
      403,
    );
  }

  await deps.assertKnowledgeBaseWriteAccess(ctx);
  const { name } = args.data;
  const dataset = sampleDatasets[snakeCase(name)];
  if (!dataset) {
    throw new Error('Sample dataset not found');
  }
  if (!(name in SampleDatasetName)) {
    throw new Error('Invalid sample dataset name');
  }

  const eventName = TelemetryEvent.CONNECTION_START_SAMPLE_DATASET;
  try {
    const project = await deps.createProjectFromConnection(
      {
        type: DataSourceName.DUCKDB,
        properties: {
          displayName: name,
          initSql: buildInitSql(name as SampleDatasetName),
          extensions: [],
          configurations: {},
        },
      },
      ctx,
    );
    const tables = await ctx.projectService.getProjectConnectionTables(project);
    const { models, columns } = await deps.overwriteModelsAndColumns(
      tables.map((table) => table.name),
      ctx,
      project,
    );

    await ctx.modelService.updatePrimaryKeys(project.id, dataset.tables);
    await ctx.modelService.batchUpdateModelProperties(
      project.id,
      dataset.tables,
    );
    await ctx.modelService.batchUpdateColumnProperties(
      project.id,
      dataset.tables,
    );

    const mappedRelations = deps.buildRelationInput(
      getRelations(name as SampleDatasetName) || [],
      models,
      columns,
    );
    await ctx.modelService.saveRelations(mappedRelations);

    const updatedProject = await ctx.projectRepository.updateOne(project.id, {
      sampleDataset: name,
    });
    await deps.deploy(ctx, updatedProject);
    ctx.telemetry.sendEvent(eventName, { datasetName: name });
    await deps.recordKnowledgeBaseWriteAudit(ctx, {
      resourceType: 'project',
      resourceId: updatedProject.id,
      afterJson: { sampleDataset: name },
      payloadJson: { operation: 'start_sample_dataset', datasetName: name },
    });
    return {
      name,
      projectId: updatedProject.id,
      runtimeScopeId: String(updatedProject.id),
    };
  } catch (err: any) {
    ctx.telemetry.sendEvent(
      eventName,
      { datasetName: name, error: err.message },
      err.extensions?.service,
      false,
    );
    throw err;
  }
};

export const saveTablesAction = async ({
  args,
  ctx,
  deps,
}: SaveTablesArgs & {
  deps: Pick<
    ProjectControllerMutationDeps,
    | 'getActiveRuntimeProjectOrThrow'
    | 'assertKnowledgeBaseWriteAccess'
    | 'overwriteModelsAndColumns'
    | 'deploy'
    | 'recordKnowledgeBaseWriteAudit'
  >;
}) => {
  const eventName = TelemetryEvent.CONNECTION_SAVE_TABLES;
  const project = await deps.getActiveRuntimeProjectOrThrow(ctx);
  await deps.assertKnowledgeBaseWriteAccess(ctx);

  try {
    const { models, columns } = await deps.overwriteModelsAndColumns(
      args.data.tables,
      ctx,
      project,
    );
    ctx.telemetry.sendEvent(eventName, {
      connectionType: project.type,
      tablesCount: models.length,
      columnsCount: columns.length,
    });
    void deps.deploy(ctx, project).catch((error: Error) => {
      logger.error(
        `Failed to deploy project ${project.id} after saving tables: ${error.message}`,
      );
    });
    await deps.recordKnowledgeBaseWriteAudit(ctx, {
      resourceType: 'project',
      resourceId: project.id,
      payloadJson: {
        operation: 'save_tables',
        tablesCount: models.length,
        columnsCount: columns.length,
      },
    });
    return { models, columns };
  } catch (err: any) {
    ctx.telemetry.sendEvent(
      eventName,
      { connectionType: project.type, error: err.message },
      err.extensions?.service,
      false,
    );
    throw err;
  }
};

export const saveRelationsAction = async ({
  args,
  ctx,
  deps,
}: SaveRelationsArgs & {
  deps: Pick<
    ProjectControllerMutationDeps,
    | 'getActiveRuntimeProjectOrThrow'
    | 'assertKnowledgeBaseWriteAccess'
    | 'ensureModelsBelongToActiveRuntime'
    | 'getCurrentPersistedRuntimeIdentity'
    | 'deploy'
    | 'recordKnowledgeBaseWriteAudit'
  >;
}) => {
  const eventName = TelemetryEvent.CONNECTION_SAVE_RELATION;
  try {
    const project = await deps.getActiveRuntimeProjectOrThrow(ctx);
    await deps.assertKnowledgeBaseWriteAccess(ctx);
    await deps.ensureModelsBelongToActiveRuntime(
      ctx,
      args.data.relations.flatMap(({ fromModelId, toModelId }) => [
        fromModelId,
        toModelId,
      ]),
      project.id,
    );
    const runtimeIdentity = deps.getCurrentPersistedRuntimeIdentity(ctx);
    const savedRelations = runtimeIdentity
      ? await ctx.modelService.saveRelationsByRuntimeIdentity(
          runtimeIdentity,
          args.data.relations,
          { preserveProjectBridge: true },
        )
      : await ctx.modelService.saveRelations(args.data.relations);
    void deps.deploy(ctx, project);
    ctx.telemetry.sendEvent(eventName, {
      relationCount: savedRelations.length,
    });
    await deps.recordKnowledgeBaseWriteAudit(ctx, {
      resourceType: 'project',
      resourceId: project.id,
      payloadJson: {
        operation: 'save_relations',
        relationCount: savedRelations.length,
      },
    });
    return savedRelations;
  } catch (err: any) {
    ctx.telemetry.sendEvent(
      eventName,
      { error: err.message },
      err.extensions?.service,
      false,
    );
    throw err;
  }
};

export const triggerConnectionDetectionAction = async ({
  ctx,
  deps,
}: TriggerConnectionDetectionArgs & {
  deps: Pick<
    ProjectControllerMutationDeps,
    | 'getActiveRuntimeProjectOrThrow'
    | 'assertKnowledgeBaseWriteAccess'
    | 'recordKnowledgeBaseWriteAudit'
  >;
}) => {
  const project = await deps.getActiveRuntimeProjectOrThrow(ctx);
  await deps.assertKnowledgeBaseWriteAccess(ctx);
  const schemaDetector = new ConnectionSchemaDetector({
    ctx,
    projectId: project.id,
  });
  const eventName = TelemetryEvent.MODELING_DETECT_SCHEMA_CHANGE;
  try {
    const hasSchemaChange = await schemaDetector.detectSchemaChange();
    ctx.telemetry.sendEvent(eventName, { hasSchemaChange });
    await deps.recordKnowledgeBaseWriteAudit(ctx, {
      resourceType: 'project',
      resourceId: project.id,
      payloadJson: {
        operation: 'trigger_connection_detection',
        hasSchemaChange,
      },
    });
    return hasSchemaChange;
  } catch (error: any) {
    ctx.telemetry.sendEvent(
      eventName,
      { error },
      error.extensions?.service,
      false,
    );
    throw error;
  }
};

export const resolveSchemaChangeAction = async ({
  type,
  ctx,
  deps,
}: {
  type: SchemaChangeType;
  ctx: TriggerConnectionDetectionArgs['ctx'];
  deps: Pick<
    ProjectControllerMutationDeps,
    | 'getActiveRuntimeProjectOrThrow'
    | 'assertKnowledgeBaseWriteAccess'
    | 'recordKnowledgeBaseWriteAudit'
  >;
}) => {
  const project = await deps.getActiveRuntimeProjectOrThrow(ctx);
  await deps.assertKnowledgeBaseWriteAccess(ctx);
  const schemaDetector = new ConnectionSchemaDetector({
    ctx,
    projectId: project.id,
  });
  const eventName = TelemetryEvent.MODELING_RESOLVE_SCHEMA_CHANGE;
  try {
    await schemaDetector.resolveSchemaChange(type);
    ctx.telemetry.sendEvent(eventName, { type });
    await deps.recordKnowledgeBaseWriteAudit(ctx, {
      resourceType: 'project',
      resourceId: project.id,
      payloadJson: { operation: 'resolve_schema_change', type },
    });
  } catch (error: any) {
    ctx.telemetry.sendEvent(
      eventName,
      { type, error },
      error.extensions?.service,
      false,
    );
    throw error;
  }
  return true;
};
