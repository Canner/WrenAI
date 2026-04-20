import {
  AnalysisRelationInfo,
  DataSourceProperties,
  IContext,
  RelationType,
} from '../types';
import { Connector, KnowledgeBase, Project } from '../repositories';
import { buildConnectionSettingsFromConnector } from '@server/utils/connectionConnectorBridge';
import ConnectionSchemaDetector, {
  SchemaChangeType,
} from '@server/managers/connectionSchemaDetector';
import { OnboardingStatus } from '@/types/project';

interface ProjectControllerReadDeps {
  resolveActiveRuntimeProject: (ctx: IContext) => Promise<Project | null>;
  resolveActiveRuntimeKnowledgeBase: (
    ctx: IContext,
  ) => Promise<KnowledgeBase | null>;
  assertKnowledgeBaseReadAccess: (ctx: IContext) => Promise<void>;
  resolveKnowledgeBaseConnectionConnector: (
    ctx: IContext,
    knowledgeBase?: KnowledgeBase | null,
  ) => Promise<Connector | null>;
  buildConnectionSettingsProperties: (args: {
    project: Project;
    knowledgeBase: KnowledgeBase | null;
    generalConnectionInfo: Record<string, any>;
  }) => Record<string, any>;
  recordKnowledgeBaseReadAudit: (
    ctx: IContext,
    args: {
      resourceType?: string | null;
      resourceId?: string | number | null;
      payloadJson?: Record<string, any> | null;
    },
  ) => Promise<void>;
}

export const getSettingsAction = async ({
  ctx,
  deps,
}: {
  ctx: IContext;
  deps: ProjectControllerReadDeps;
}) => {
  if (!ctx.runtimeScope) {
    throw new Error('Active runtime project is required for this operation');
  }

  const [project, knowledgeBase] = await Promise.all([
    deps.resolveActiveRuntimeProject(ctx),
    deps.resolveActiveRuntimeKnowledgeBase(ctx),
  ]);
  await deps.assertKnowledgeBaseReadAccess(ctx);
  const connector = await deps.resolveKnowledgeBaseConnectionConnector(
    ctx,
    knowledgeBase,
  );
  const generalConnectionInfo = project
    ? ctx.projectService.getGeneralConnectionInfo(project)
    : null;
  const connectorBackedConnection = connector
    ? buildConnectionSettingsFromConnector({
        displayName: connector.displayName,
        databaseProvider: connector.databaseProvider,
        config: connector.configJson,
      })
    : null;

  const connection = connectorBackedConnection
    ? {
        ...connectorBackedConnection,
        sampleDataset: knowledgeBase?.sampleDataset ?? null,
      }
    : project
      ? {
          type: project.type,
          properties: deps.buildConnectionSettingsProperties({
            project,
            knowledgeBase,
            generalConnectionInfo: generalConnectionInfo || {},
          }) as DataSourceProperties,
          sampleDataset: knowledgeBase?.sampleDataset ?? project.sampleDataset,
        }
      : null;

  const result = {
    productVersion: ctx.config.wrenProductVersion || '',
    connection,
    language: knowledgeBase?.language ?? project?.language ?? null,
  };
  await deps.recordKnowledgeBaseReadAudit(ctx, {
    resourceType: knowledgeBase
      ? 'knowledge_base'
      : project
        ? 'project'
        : 'workspace',
    resourceId:
      knowledgeBase?.id ||
      project?.id ||
      ctx.runtimeScope.workspace?.id ||
      null,
    payloadJson: {
      operation: 'get_settings',
    },
  });
  return result;
};

export const getProjectRecommendationQuestionsAction = async ({
  ctx,
  deps,
}: {
  ctx: IContext;
  deps: Pick<
    ProjectControllerReadDeps,
    | 'resolveActiveRuntimeProject'
    | 'resolveActiveRuntimeKnowledgeBase'
    | 'assertKnowledgeBaseReadAccess'
    | 'recordKnowledgeBaseReadAudit'
  >;
}) => {
  await deps.assertKnowledgeBaseReadAccess(ctx);
  const project = await deps.resolveActiveRuntimeProject(ctx);
  const knowledgeBase = await deps.resolveActiveRuntimeKnowledgeBase(ctx);

  if (!project) {
    const result = { status: 'NOT_STARTED', questions: [], error: null };
    await deps.recordKnowledgeBaseReadAudit(ctx, {
      resourceType: knowledgeBase ? 'knowledge_base' : 'workspace',
      resourceId: knowledgeBase?.id || ctx.runtimeScope?.workspace?.id || null,
      payloadJson: { operation: 'get_project_recommendation_questions' },
    });
    return result;
  }

  const result = await ctx.projectService.getProjectRecommendationQuestions(
    project.id,
  );
  await deps.recordKnowledgeBaseReadAudit(ctx, {
    resourceType: 'project',
    resourceId: project.id,
    payloadJson: { operation: 'get_project_recommendation_questions' },
  });
  return result;
};

export const getOnboardingStatusAction = async ({
  ctx,
  deps,
}: {
  ctx: IContext;
  deps: Pick<
    ProjectControllerReadDeps,
    | 'resolveActiveRuntimeProject'
    | 'resolveActiveRuntimeKnowledgeBase'
    | 'assertKnowledgeBaseReadAccess'
    | 'recordKnowledgeBaseReadAudit'
  >;
}) => {
  await deps.assertKnowledgeBaseReadAccess(ctx);
  const knowledgeBase = await deps.resolveActiveRuntimeKnowledgeBase(ctx);
  const project = await deps.resolveActiveRuntimeProject(ctx);
  const sampleDataset = knowledgeBase?.sampleDataset ?? project?.sampleDataset;

  if (sampleDataset) {
    await deps.recordKnowledgeBaseReadAudit(ctx, {
      resourceType: knowledgeBase ? 'knowledge_base' : 'project',
      resourceId: knowledgeBase?.id || project?.id || null,
      payloadJson: { operation: 'get_onboarding_status' },
    });
    return { status: OnboardingStatus.WITH_SAMPLE_DATASET };
  }

  if (!project) {
    const status =
      knowledgeBase?.primaryConnectorId || knowledgeBase?.defaultKbSnapshotId
        ? OnboardingStatus.CONNECTION_SAVED
        : OnboardingStatus.NOT_STARTED;
    await deps.recordKnowledgeBaseReadAudit(ctx, {
      resourceType: knowledgeBase ? 'knowledge_base' : 'workspace',
      resourceId: knowledgeBase?.id || ctx.runtimeScope?.workspace?.id,
      payloadJson: { operation: 'get_onboarding_status' },
    });
    return { status };
  }

  const models = await ctx.modelRepository.findAllBy({ projectId: project.id });
  await deps.recordKnowledgeBaseReadAudit(ctx, {
    resourceType: knowledgeBase ? 'knowledge_base' : 'project',
    resourceId: knowledgeBase?.id || project.id,
    payloadJson: { operation: 'get_onboarding_status' },
  });
  return {
    status: models.length
      ? OnboardingStatus.ONBOARDING_FINISHED
      : OnboardingStatus.CONNECTION_SAVED,
  };
};

export const listConnectionTablesAction = async ({
  ctx,
  deps,
}: {
  ctx: IContext;
  deps: Pick<
    ProjectControllerReadDeps,
    | 'resolveActiveRuntimeProject'
    | 'resolveActiveRuntimeKnowledgeBase'
    | 'assertKnowledgeBaseReadAccess'
    | 'recordKnowledgeBaseReadAudit'
  >;
}) => {
  await deps.assertKnowledgeBaseReadAccess(ctx);
  const project = await deps.resolveActiveRuntimeProject(ctx);
  const knowledgeBase = await deps.resolveActiveRuntimeKnowledgeBase(ctx);
  if (!project) {
    await deps.recordKnowledgeBaseReadAudit(ctx, {
      resourceType: knowledgeBase ? 'knowledge_base' : 'workspace',
      resourceId: knowledgeBase?.id || ctx.runtimeScope?.workspace?.id || null,
      payloadJson: { operation: 'list_data_source_tables' },
    });
    return [];
  }

  const result = await ctx.projectService.getProjectConnectionTables(project);
  await deps.recordKnowledgeBaseReadAudit(ctx, {
    resourceType: 'project',
    resourceId: project.id,
    payloadJson: { operation: 'list_data_source_tables' },
  });
  return result;
};

export const autoGenerateRelationAction = async ({
  ctx,
  deps,
}: {
  ctx: IContext;
  deps: Pick<
    ProjectControllerReadDeps,
    | 'resolveActiveRuntimeProject'
    | 'resolveActiveRuntimeKnowledgeBase'
    | 'assertKnowledgeBaseReadAccess'
    | 'recordKnowledgeBaseReadAudit'
  >;
}) => {
  await deps.assertKnowledgeBaseReadAccess(ctx);
  const project = await deps.resolveActiveRuntimeProject(ctx);
  const knowledgeBase = await deps.resolveActiveRuntimeKnowledgeBase(ctx);
  if (!project) {
    await deps.recordKnowledgeBaseReadAudit(ctx, {
      resourceType: knowledgeBase ? 'knowledge_base' : 'workspace',
      resourceId: knowledgeBase?.id || ctx.runtimeScope?.workspace?.id || null,
      payloadJson: { operation: 'auto_generate_relation' },
    });
    return [];
  }

  const models = await ctx.modelRepository.findAllBy({ projectId: project.id });
  const modelIds = models.map((model) => model.id);
  const columns =
    await ctx.modelColumnRepository.findColumnsByModelIds(modelIds);
  const constraints =
    await ctx.projectService.getProjectSuggestedConstraint(project);

  const relations: AnalysisRelationInfo[] = [];
  for (const constraint of constraints) {
    const fromModel = models.find(
      (model) => model.sourceTableName === constraint.constraintTable,
    );
    const toModel = models.find(
      (model) => model.sourceTableName === constraint.constraintedTable,
    );
    if (!fromModel || !toModel) {
      continue;
    }
    const fromColumn = columns.find(
      (column) =>
        column.modelId === fromModel.id &&
        column.sourceColumnName === constraint.constraintColumn,
    );
    const toColumn = columns.find(
      (column) =>
        column.modelId === toModel.id &&
        column.sourceColumnName === constraint.constraintedColumn,
    );
    if (!fromColumn || !toColumn) {
      continue;
    }

    relations.push({
      name: constraint.constraintName,
      fromModelId: fromModel.id,
      fromModelReferenceName: fromModel.referenceName,
      fromColumnId: fromColumn.id,
      fromColumnReferenceName: fromColumn.referenceName,
      toModelId: toModel.id,
      toModelReferenceName: toModel.referenceName,
      toColumnId: toColumn.id,
      toColumnReferenceName: toColumn.referenceName,
      type: RelationType.ONE_TO_MANY,
    });
  }

  const result = models.map(({ id, displayName, referenceName }) => ({
    id,
    displayName,
    referenceName,
    relations: relations.filter(
      (relation) =>
        relation.fromModelId === id &&
        relation.toModelId !== relation.fromModelId,
    ),
  }));
  await deps.recordKnowledgeBaseReadAudit(ctx, {
    resourceType: 'project',
    resourceId: project.id,
    payloadJson: { operation: 'auto_generate_relation' },
  });
  return result;
};

export const getSchemaChangeAction = async ({
  ctx,
  deps,
}: {
  ctx: IContext;
  deps: Pick<
    ProjectControllerReadDeps,
    | 'resolveActiveRuntimeProject'
    | 'resolveActiveRuntimeKnowledgeBase'
    | 'assertKnowledgeBaseReadAccess'
    | 'recordKnowledgeBaseReadAudit'
  >;
}) => {
  await deps.assertKnowledgeBaseReadAccess(ctx);
  const project = await deps.resolveActiveRuntimeProject(ctx);
  const knowledgeBase = await deps.resolveActiveRuntimeKnowledgeBase(ctx);
  const emptyResult = {
    deletedTables: null,
    deletedColumns: null,
    modifiedColumns: null,
    lastSchemaChangeTime: null,
  };

  if (!project) {
    await deps.recordKnowledgeBaseReadAudit(ctx, {
      resourceType: knowledgeBase ? 'knowledge_base' : 'workspace',
      resourceId: knowledgeBase?.id || ctx.runtimeScope?.workspace?.id || null,
      payloadJson: { operation: 'get_schema_change' },
    });
    return emptyResult;
  }

  const lastSchemaChange =
    await ctx.schemaChangeRepository.findLastSchemaChange(project.id);
  if (!lastSchemaChange) {
    await deps.recordKnowledgeBaseReadAudit(ctx, {
      resourceType: 'project',
      resourceId: project.id,
      payloadJson: { operation: 'get_schema_change' },
    });
    return emptyResult;
  }

  const models = await ctx.modelRepository.findAllBy({ projectId: project.id });
  const modelIds = models.map((model) => model.id);
  const modelColumns =
    await ctx.modelColumnRepository.findColumnsByModelIds(modelIds);
  const modelRelationships = await ctx.relationRepository.findRelationInfoBy({
    modelIds,
  });
  const schemaDetector = new ConnectionSchemaDetector({
    ctx,
    projectId: project.id,
  });

  const unresolvedChanges = (
    Object.values(SchemaChangeType) as SchemaChangeType[]
  ).reduce((result, key) => {
    const changes = lastSchemaChange.change[key];
    if (lastSchemaChange.resolve[key] || !changes) {
      return result;
    }

    const affecteds = schemaDetector.getAffectedResources(changes, {
      models,
      modelColumns,
      modelRelationships,
    });
    return { ...result, [key]: affecteds.length ? affecteds : null };
  }, {});

  const result = {
    ...unresolvedChanges,
    lastSchemaChangeTime: lastSchemaChange.createdAt,
  };
  await deps.recordKnowledgeBaseReadAudit(ctx, {
    resourceType: 'project',
    resourceId: project.id,
    payloadJson: { operation: 'get_schema_change' },
  });
  return result;
};
