import { v4 as uuidv4 } from 'uuid';
import {
  Model,
  ModelColumn,
  ModelNestedColumn,
  RelationInfo,
  View,
} from '@server/repositories';
import { toPersistedRuntimeIdentity } from '@server/context/runtimeScope';
import {
  Diagram,
  DiagramModel,
  DiagramModelField,
  DiagramModelRelationField,
  NodeType,
  IContext,
  RelationType,
  DiagramView,
} from '@server/types';
import { ColumnMDL, Manifest } from '@server/mdl/type';
import { getLogger } from '@server/utils';
import {
  assertAuthorizedWithAudit,
  buildAuthorizationActorFromRuntimeScope,
  recordAuditEvent,
} from '@server/authz';

const logger = getLogger('DiagramController');
logger.level = 'debug';

const isMissingRuntimeExecutionContextError = (error: unknown) =>
  error instanceof Error &&
  (error.message === 'No deployment found, please deploy your project first' ||
    error.message ===
      'MDL runtime identity requires deploy metadata or resolvable project metadata');

const parseJsonObject = (value?: string | null): Record<string, any> => {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const requireAuthorizationActor = (ctx: IContext) =>
  ctx.authorizationActor ||
  buildAuthorizationActorFromRuntimeScope(ctx.runtimeScope);

const assertKnowledgeBaseReadAccess = async (ctx: IContext) => {
  const { actor, resource } = getKnowledgeBaseReadAuthorizationTarget(ctx);
  await assertAuthorizedWithAudit({
    auditEventRepository: ctx.auditEventRepository,
    actor,
    action: 'knowledge_base.read',
    resource,
  });
};

const getKnowledgeBaseReadAuthorizationTarget = (ctx: IContext) => {
  const runtimeIdentity = toPersistedRuntimeIdentity(ctx.runtimeScope!);
  const workspaceId =
    ctx.runtimeScope?.workspace?.id || runtimeIdentity.workspaceId || null;
  const knowledgeBase = ctx.runtimeScope?.knowledgeBase;

  return {
    actor: requireAuthorizationActor(ctx),
    resource: {
      resourceType: knowledgeBase ? 'knowledge_base' : 'workspace',
      resourceId: knowledgeBase?.id || workspaceId,
      workspaceId,
      attributes: {
        workspaceKind: ctx.runtimeScope?.workspace?.kind || null,
        knowledgeBaseKind: knowledgeBase?.kind || null,
      },
    },
  };
};

const recordKnowledgeBaseReadAudit = async (ctx: IContext) => {
  const { actor, resource } = getKnowledgeBaseReadAuthorizationTarget(ctx);
  await recordAuditEvent({
    auditEventRepository: ctx.auditEventRepository,
    actor,
    action: 'knowledge_base.read',
    resource: {
      ...resource,
      resourceType: 'diagram',
    },
    result: 'allowed',
    payloadJson: {
      operation: 'get_diagram',
    },
  });
};

export class DiagramController {
  constructor() {
    this.getDiagram = this.getDiagram.bind(this);
  }

  public async getDiagram({ ctx }: { ctx: IContext }): Promise<Diagram> {
    await assertKnowledgeBaseReadAccess(ctx);
    const runtimeIdentity = toPersistedRuntimeIdentity(ctx.runtimeScope!);
    let manifest: Manifest = {
      models: [],
      relationships: [],
      views: [],
    };
    try {
      const mdlResult =
        await ctx.mdlService.makeCurrentModelMDLByRuntimeIdentity(
          runtimeIdentity,
        );
      manifest = mdlResult.manifest;
    } catch (error) {
      if (!isMissingRuntimeExecutionContextError(error)) {
        throw error;
      }
    }
    const models =
      await ctx.modelRepository.findAllByRuntimeIdentity(runtimeIdentity);

    const modelIds = models.map((model) => model.id);
    const modelColumns =
      await ctx.modelColumnRepository.findColumnsByModelIds(modelIds);
    const modelNestedColumns =
      await ctx.modelNestedColumnRepository.findNestedColumnsByModelIds(
        modelIds,
      );
    const modelRelations = await ctx.relationRepository.findRelationInfoBy({
      columnIds: modelColumns.map((column) => column.id),
    });
    const views =
      await ctx.viewRepository.findAllByRuntimeIdentity(runtimeIdentity);

    const result = this.buildDiagram(
      models,
      modelColumns,
      modelNestedColumns,
      modelRelations,
      views,
      manifest,
    );
    await recordKnowledgeBaseReadAudit(ctx);
    return result;
  }

  private buildDiagram(
    models: Model[],
    modelColumns: ModelColumn[],
    modelNestedColumns: ModelNestedColumn[],
    relations: RelationInfo[],
    views: View[],
    manifest: Manifest,
  ): Diagram {
    const diagramModels = models.map((model) => {
      const transformedModel = this.transformModel(model);
      const allColumns = modelColumns.filter(
        (column) => column.modelId === model.id,
      );
      const modelMDL = (manifest.models || []).find(
        (modelMDL) => modelMDL.name === model.referenceName,
      );
      allColumns.forEach((column) => {
        const columnRelations = relations
          .map((relation) =>
            [relation.fromColumnId, relation.toColumnId].includes(column.id)
              ? relation
              : null,
          )
          .filter((relation): relation is RelationInfo => Boolean(relation));

        if (columnRelations.length > 0) {
          columnRelations.forEach((relation) => {
            const transformedRelationField = this.transformModelRelationField({
              relation,
              currentModel: model,
              models,
            });
            transformedModel.relationFields.push(transformedRelationField);
          });
        }

        if (column.isCalculated) {
          transformedModel.calculatedFields.push(
            this.transformCalculatedField(column, modelMDL?.columns || []),
          );
        } else {
          const nestedColumns = modelNestedColumns.filter(
            (nestedColumn) => nestedColumn.columnId === column.id,
          );
          transformedModel.fields.push(
            this.transformNormalField(column, nestedColumns),
          );
        }
      });
      return transformedModel;
    });

    const diagramViews = views.map(this.transformView);
    return { models: diagramModels, views: diagramViews };
  }

  private transformModel(model: Model): DiagramModel {
    const properties = parseJsonObject(model.properties);
    return {
      id: uuidv4(),
      modelId: model.id,
      nodeType: NodeType.MODEL,
      displayName: model.displayName,
      referenceName: model.referenceName,
      sourceTableName: model.sourceTableName,
      refSql: model.refSql,
      refreshTime: model.refreshTime || '',
      cached: model.cached,
      description: properties?.description || '',
      fields: [],
      calculatedFields: [],
      relationFields: [],
    };
  }

  private transformNormalField(
    column: ModelColumn,
    nestedColumns: ModelNestedColumn[],
  ): DiagramModelField {
    const properties = parseJsonObject(column.properties);
    return {
      id: uuidv4(),
      columnId: column.id,
      nodeType: column.isCalculated
        ? NodeType.CALCULATED_FIELD
        : NodeType.FIELD,
      type: column.type,
      displayName: column.displayName,
      referenceName: column.referenceName,
      description: properties?.description || '',
      isPrimaryKey: column.isPk,
      expression: column.aggregation,
      nestedFields: nestedColumns.length
        ? nestedColumns.map((nestedColumn) => ({
            id: uuidv4(),
            nestedColumnId: nestedColumn.id,
            columnPath: nestedColumn.columnPath,
            type: nestedColumn.type,
            displayName: nestedColumn.displayName,
            referenceName: nestedColumn.referenceName,
            description: nestedColumn.properties?.description || '',
          }))
        : undefined,
    };
  }

  private transformCalculatedField(
    column: ModelColumn,
    columnsMDL: ColumnMDL[],
  ): DiagramModelField {
    const properties = parseJsonObject(column.properties);
    const columnMDL = columnsMDL.find(
      ({ name }) => name === column.referenceName,
    );
    return {
      id: uuidv4(),
      columnId: column.id,
      nodeType: NodeType.CALCULATED_FIELD,
      aggregation: column.aggregation,
      lineage: column.lineage || '[]',
      type: column.type,
      displayName: column.displayName,
      referenceName: column.referenceName,
      description: properties?.description || '',
      isPrimaryKey: column.isPk,
      expression: columnMDL?.expression,
    };
  }

  private transformModelRelationField({
    relation,
    currentModel,
    models,
  }: {
    relation: RelationInfo;
    currentModel: Model;
    models: Model[];
  }): DiagramModelRelationField {
    const referenceName =
      currentModel.referenceName === relation.fromModelName
        ? relation.toModelName
        : relation.fromModelName;
    const displayName = models.find(
      (model) => model.referenceName === referenceName,
    )?.displayName;
    const properties = parseJsonObject(relation.properties);
    return {
      id: uuidv4(),
      relationId: relation.id,
      nodeType: NodeType.RELATION,
      displayName: displayName || referenceName,
      referenceName,
      type: relation.joinType as RelationType,
      fromModelId: relation.fromModelId,
      fromModelName: relation.fromModelName,
      fromModelDisplayName: relation.fromModelDisplayName,
      fromColumnId: relation.fromColumnId,
      fromColumnName: relation.fromColumnName,
      fromColumnDisplayName: relation.fromColumnDisplayName,
      toModelId: relation.toModelId,
      toModelName: relation.toModelName,
      toModelDisplayName: relation.toModelDisplayName,
      toColumnId: relation.toColumnId,
      toColumnName: relation.toColumnName,
      toColumnDisplayName: relation.toColumnDisplayName,
      description: properties?.description || '',
    };
  }

  private transformView(view: View): DiagramView {
    const properties = parseJsonObject(view.properties);
    const fields = (properties?.columns || []).map((column: any) => ({
      id: uuidv4(),
      nodeType: NodeType.FIELD,
      type: column.type,
      displayName: column.name,
      referenceName: column.name,
      description: column?.properties?.description || '',
    }));

    return {
      id: uuidv4(),
      viewId: view.id,
      nodeType: NodeType.VIEW,
      statement: view.statement,
      referenceName: view.name,
      displayName: properties?.displayName || view.name,
      fields,
      description: properties?.description || '',
    };
  }
}
