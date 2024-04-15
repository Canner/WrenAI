import { isEmpty, pickBy } from 'lodash';
import {
  Model,
  ModelColumn,
  Project,
  RelationInfo,
  View,
} from '../repositories';
import { Manifest, ModelMDL, ViewMDL } from './type';
import { getLogger } from '@server/utils';

const logger = getLogger('MDLBuilder');
logger.level = 'debug';

export interface MDLBuilderBuildFromOptions {
  project: Project;
  models: Model[];
  columns?: ModelColumn[];
  relations?: RelationInfo[];
  views: View[];
  relatedModels?: Model[];
  relatedColumns?: ModelColumn[];
  relatedRelations?: RelationInfo[];
}

export interface IMDLBuilder {
  build(): Manifest; //facade method to build the manifest json
}

// responsible to generate a valid manifest json
export class MDLBuilder implements IMDLBuilder {
  private manifest: Manifest;

  private project: Project;
  private readonly models: Model[];
  private readonly columns: ModelColumn[];
  private readonly relations: RelationInfo[];
  private readonly views: View[];

  // related models, columns, and relations are used as the reference to build calculatedField expression or other
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private readonly relatedModels: Model[];
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private readonly relatedColumns: ModelColumn[];
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private readonly relatedRelations: RelationInfo[];

  constructor(builderOptions: MDLBuilderBuildFromOptions) {
    const {
      project,
      models,
      columns,
      relations,
      views,
      relatedModels,
      relatedColumns,
      relatedRelations,
    } = builderOptions;
    this.project = project;
    this.models = models;
    this.columns = columns;
    this.relations = relations;
    this.views = views || [];
    this.relatedModels = relatedModels;
    this.relatedColumns = relatedColumns;
    this.relatedRelations = relatedRelations;

    // init manifest
    this.manifest = {};
  }

  public build(): Manifest {
    this.addProject();
    this.addModel();
    this.addColumn();
    this.addRelation();
    this.addView();
    return this.getManifest();
  }

  public getManifest(): Manifest {
    return this.manifest;
  }

  public addModel(): void {
    if (!isEmpty(this.manifest.models)) {
      return;
    }
    this.manifest.models = this.models.map((model: Model) => {
      return {
        name: model.referenceName,
        columns: [],
        refSql: model.refSql,
        cached: model.cached,
        refreshTime: model.refreshTime,
        properties: JSON.parse(model.properties),
        primaryKey: '', // will be modified in addColumn
      } as ModelMDL;
    });
  }

  public addView(): void {
    if (!isEmpty(this.manifest.views)) {
      return;
    }
    this.manifest.views = this.views.map((view: View) => {
      // if putting properties not string, it will throw error
      // filter out properties that have string value
      const properties = pickBy<ViewMDL['properties']>(
        JSON.parse(view.properties),
        (value) => typeof value === 'string',
      );
      return {
        name: view.name,
        statement: view.statement,
        properties,
      };
    });
  }

  public addColumn(): void {
    // should addModel first
    if (isEmpty(this.manifest.models)) {
      logger.debug('No model in manifest, should build model first');
      return;
    }
    this.columns.forEach((column: ModelColumn) => {
      // validate manifest.model exist
      const modelRefName = this.models.find(
        (model: any) => model.id === column.modelId,
      )?.referenceName;
      if (!modelRefName) {
        logger.debug(
          `Build MDL Column Error: can not find model, modelId ${column.modelId}, columnId: ${column.id}`,
        );
        return;
      }
      const model = this.manifest.models.find(
        (model: any) => model.name === modelRefName,
      );

      // modify model primary key
      if (column.isPk) {
        model.primaryKey = column.referenceName;
      }

      // add column into model
      if (!model.columns) {
        model.columns = [];
      }
      const expression = this.getColumnExpression(column);
      model.columns.push({
        name: column.referenceName,
        type: column.type,
        isCalculated: column.isCalculated,
        notNull: column.notNull,
        expression,
        properties: JSON.parse(column.properties),
      });
    });
  }

  public addRelation(): void {
    this.manifest.relationships = this.relations.map(
      (relation: RelationInfo) => {
        const {
          name,
          joinType,
          fromModelName,
          fromColumnName,
          toModelName,
          toColumnName,
        } = relation;
        const condition = this.getRelationCondition(relation);
        this.addRelationColumn(fromModelName, {
          modelReferenceName: toModelName,
          columnReferenceName: toColumnName,
          relation: name,
        });
        this.addRelationColumn(toModelName, {
          modelReferenceName: fromModelName,
          columnReferenceName: fromColumnName,
          relation: name,
        });
        return {
          name: name,
          models: [fromModelName, toModelName],
          joinType: joinType,
          condition,
        };
      },
    );
  }

  public addProject(): void {
    this.manifest.schema = this.project.schema;
    this.manifest.catalog = this.project.catalog;
  }

  protected addRelationColumn(
    modelName: string,
    columnData: {
      modelReferenceName: string;
      columnReferenceName: string;
      relation: string;
    },
  ) {
    const model = this.manifest.models.find(
      (model: any) => model.name === modelName,
    );
    if (!model) {
      logger.debug(`Can not find model "${modelName}" to add relation column`);
      return;
    }
    if (!model.columns) {
      model.columns = [];
    }
    // check if the modelReferenceName is already in the model column
    const modelNameDuplicated = model.columns.find(
      (column: any) => column.name === columnData.modelReferenceName,
    );
    const column = {
      name: modelNameDuplicated
        ? `${columnData.modelReferenceName}_${columnData.columnReferenceName}`
        : columnData.modelReferenceName,
      type: columnData.modelReferenceName,
      properties: null,
      relationship: columnData.relation,
      isCalculated: false,
      notNull: false,
    };
    model.columns.push(column);
  }

  protected getColumnExpression(column: ModelColumn): string {
    if (column.isCalculated) {
      // calculated field
      //TODO phase2: implement the expression for calculated field
      return column.aggregation;
    }
    // normal field
    return '';
  }

  protected getRelationCondition(relation: RelationInfo): string {
    //TODO phase2: implement the expression for relation condition
    const { fromColumnName, toColumnName, fromModelName, toModelName } =
      relation;
    return `${fromModelName}.${fromColumnName} = ${toModelName}.${toColumnName}`;
  }
}
