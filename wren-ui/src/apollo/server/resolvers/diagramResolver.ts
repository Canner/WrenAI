import { v4 as uuidv4 } from 'uuid';
import {
  Model,
  ModelColumn,
  ModelNestedColumn,
  RelationInfo,
  View,
} from '@server/repositories';
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
import { MDLBuilder } from '../mdl/mdlBuilder';

const logger = getLogger('DiagramResolver');
logger.level = 'debug';

export class DiagramResolver {
  constructor() {
    this.getDiagram = this.getDiagram.bind(this);
  }

  public async getDiagram(
    _root: any,
    _args: any,
    ctx: IContext,
  ): Promise<Diagram> {
    const project = await ctx.projectRepository.getCurrentProject();
    const models = await ctx.modelRepository.findAllBy({
      projectId: project.id,
    });

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
    const views = await ctx.viewRepository.findAllBy({
      projectId: project.id,
    });

    const builder = new MDLBuilder({
      project,
      models,
      columns: modelColumns,
      nestedColumns: modelNestedColumns,
      relations: modelRelations,
      views,
      relatedModels: models,
      relatedColumns: modelColumns,
      relatedRelations: modelRelations,
    });

    const manifest = builder.build();

    return this.buildDiagram(
      models,
      modelColumns,
      modelNestedColumns,
      modelRelations,
      views,
      manifest,
    );
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
      const modelMDL = manifest.models.find(
        (modelMDL) => modelMDL.name === model.referenceName,
      );
      allColumns.forEach((column) => {
        const columnRelations = relations
          .map((relation) =>
            [relation.fromColumnId, relation.toColumnId].includes(column.id)
              ? relation
              : null,
          )
          .filter((relation) => !!relation);

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
            this.transformCalculatedField(column, modelMDL.columns),
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
    const properties = JSON.parse(model.properties);
    return {
      id: uuidv4(),
      modelId: model.id,
      nodeType: NodeType.MODEL,
      displayName: model.displayName,
      referenceName: model.referenceName,
      sourceTableName: model.sourceTableName,
      refSql: model.refSql,
      refreshTime: model.refreshTime,
      cached: model.cached,
      description: properties?.description,
      fields: [],
      calculatedFields: [],
      relationFields: [],
    };
  }

  private transformNormalField(
    column: ModelColumn,
    nestedColumns: ModelNestedColumn[],
  ): DiagramModelField {
    const properties = JSON.parse(column.properties);
    return {
      id: uuidv4(),
      columnId: column.id,
      nodeType: column.isCalculated
        ? NodeType.CALCULATED_FIELD
        : NodeType.FIELD,
      type: column.type,
      displayName: column.displayName,
      referenceName: column.referenceName,
      description: properties?.description,
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
            description: nestedColumn.properties?.description,
          }))
        : null,
    };
  }

  private transformCalculatedField(
    column: ModelColumn,
    columnsMDL: ColumnMDL[],
  ): DiagramModelField {
    const properties = JSON.parse(column.properties);
    const lineage = JSON.parse(column.lineage);
    const columnMDL = columnsMDL.find(
      ({ name }) => name === column.referenceName,
    );
    return {
      id: uuidv4(),
      columnId: column.id,
      nodeType: NodeType.CALCULATED_FIELD,
      aggregation: column.aggregation,
      lineage,
      type: column.type,
      displayName: column.displayName,
      referenceName: column.referenceName,
      description: properties?.description,
      isPrimaryKey: column.isPk,
      expression: columnMDL.expression,
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
    const properties = relation.properties
      ? JSON.parse(relation.properties)
      : null;
    return {
      id: uuidv4(),
      relationId: relation.id,
      nodeType: NodeType.RELATION,
      displayName,
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
      description: properties?.description,
    };
  }

  private transformView(view: View): DiagramView {
    const properties = JSON.parse(view.properties);
    const fields = (properties?.columns || []).map((column: any) => ({
      id: uuidv4(),
      nodeType: NodeType.FIELD,
      type: column.type,
      displayName: column.name,
      referenceName: column.name,
      description: column?.properties?.description,
    }));

    return {
      id: uuidv4(),
      viewId: view.id,
      nodeType: NodeType.VIEW,
      statement: view.statement,
      referenceName: view.name,
      displayName: properties?.displayName || view.name,
      fields,
      description: properties?.description,
    };
  }
}
