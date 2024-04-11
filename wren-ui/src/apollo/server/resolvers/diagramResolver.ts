import { v4 as uuidv4 } from 'uuid';
import { Model, ModelColumn, RelationInfo, View } from '@server/repositories';
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
import { getLogger } from '@server/utils';

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
    const modelColumns = await ctx.modelColumnRepository.findColumnsByModelIds(
      models.map((model) => model.id),
    );
    const modelRelations = await ctx.relationRepository.findRelationInfoBy({
      columnIds: modelColumns.map((column) => column.id),
    });
    const views = await ctx.viewRepository.findAllBy({
      projectId: project.id,
    });

    return this.buildDiagram(models, modelColumns, modelRelations, views);
  }

  private buildDiagram(
    models: Model[],
    modelColumns: ModelColumn[],
    relations: RelationInfo[],
    views: View[],
  ): Diagram {
    const diagramModels = models.map((model) => {
      const transformedModel = this.transformModel(model);
      const allColumns = modelColumns.filter(
        (column) => column.modelId === model.id,
      );
      allColumns.forEach((column) => {
        const relation = relations.find((relation) =>
          [relation.fromColumnId, relation.toColumnId].includes(column.id),
        );

        if (relation) {
          const transformedRelationField = this.transformModelRelationField({
            relation,
            currentModel: model,
            models,
          });
          transformedModel.relationFields.push(transformedRelationField);
        }

        if (column.isCalculated) {
          transformedModel.calculatedFields.push(
            this.transformModelField(column),
          );
        } else {
          transformedModel.fields.push(this.transformModelField(column));
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
      description: properties?.description || '',
      fields: [],
      calculatedFields: [],
      relationFields: [],
    };
  }

  private transformModelField(column: ModelColumn): DiagramModelField {
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
      description: properties?.description || '',
      isPrimaryKey: column.isPk,
      expression: column.aggregation,
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
    return {
      id: uuidv4(),
      relationId: relation.id,
      nodeType: NodeType.RELATION,
      displayName,
      referenceName,
      type: relation.joinType as RelationType,
      fromModelName: relation.fromModelName,
      fromColumnName: relation.fromColumnName,
      toModelName: relation.toModelName,
      toColumnName: relation.toColumnName,
    };
  }

  private transformView(view: View): DiagramView {
    const properties = JSON.parse(view.properties);
    return {
      id: uuidv4(),
      viewId: view.id,
      nodeType: NodeType.VIEW,
      statement: view.statement,
      referenceName: view.name,
      displayName: properties?.displayName || view.name,
    };
  }
}
