import { isEmpty, isNil, pickBy } from 'lodash';
import {
  Model,
  ModelColumn,
  Project,
  RelationInfo,
  View,
} from '../repositories';
import { Manifest, ModelMDL, TableReference } from './type';
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
    this.addNormalField();
    this.addRelation();
    this.addCalculatedField();
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
      const properties = model.properties ? JSON.parse(model.properties) : {};
      // put displayName in properties
      if (model.displayName) {
        properties.displayName = model.displayName;
      }
      const tableReference = this.buildTableReference(model);

      return {
        name: model.referenceName,
        columns: [],
        tableReference,
        // can only have one of refSql or tableReference
        refSql: tableReference ? null : model.refSql,
        cached: model.cached,
        refreshTime: model.refreshTime,
        properties: {
          displayName: model.displayName,
          description: properties.description,
        },
        primaryKey: '', // will be modified in addColumn
      } as ModelMDL;
    });
  }

  public addView(): void {
    if (!isEmpty(this.manifest.views)) {
      return;
    }
    this.manifest.views = this.views.map((view: View) => {
      const properties = JSON.parse(view.properties) || {};

      // filter out properties that are not null or undefined
      // and are in the list of properties that are allowed
      const viewProperties = pickBy(properties, (value, key) => {
        return (
          !isNil(value) &&
          ['displayName', 'description', 'question', 'summary'].includes(key)
        );
      });

      return {
        name: view.name,
        statement: view.statement,
        properties: {
          ...viewProperties,

          // viewId will be passed back in other APIs
          // to identify the view
          viewId: view.id.toString(),
        },
      };
    });
  }

  public addNormalField(): void {
    // should addModel first
    if (isEmpty(this.manifest.models)) {
      logger.debug('No model in manifest, should build model first');
      return;
    }
    this.columns
      .filter(({ isCalculated }) => !isCalculated)
      .forEach((column: ModelColumn) => {
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
        const properties = column.properties
          ? JSON.parse(column.properties)
          : {};
        // put displayName in properties
        if (column.displayName) {
          properties.displayName = column.displayName;
        }
        const expression = this.getColumnExpression(column, model);
        model.columns.push({
          name: column.referenceName,
          type: column.type,
          isCalculated: column.isCalculated,
          notNull: column.notNull,
          expression,
          properties: properties,
        });
      });
  }

  public addCalculatedField(): void {
    // should addModel first
    if (isEmpty(this.manifest.models)) {
      logger.debug('No model in manifest, should build model first');
      return;
    }
    this.columns
      .filter(({ isCalculated }) => isCalculated)
      .forEach((column: ModelColumn) => {
        // validate manifest.model exist
        const relatedModel = this.relatedModels.find(
          (model: any) => model.id === column.modelId,
        );
        const model = this.manifest.models.find(
          (model: any) => model.name === relatedModel.referenceName,
        );
        if (!model) {
          logger.debug(
            `Build MDL Column Error: can not find model, modelId "${column.modelId}", columnId: "${column.id}"`,
          );
          return;
        }
        const expression = this.getColumnExpression(column, model);
        const columnValue = {
          name: column.referenceName,
          type: column.type,
          isCalculated: true,
          expression,
          notNull: column.notNull,
          properties: JSON.parse(column.properties),
        };
        model.columns.push(columnValue);
      });
  }

  public insertCalculatedField(
    modelName: string,
    calculatedField: ModelColumn,
  ) {
    const model = this.manifest.models.find(
      (model: any) => model.name === modelName,
    );
    if (!model) {
      logger.debug(`Can not find model "${modelName}" to add calculated field`);
      return;
    }
    // if calculated field is already in the model, skip
    if (
      model.columns.find(
        (column: any) => column.name === calculatedField.referenceName,
      )
    ) {
      return;
    }
    const expression = this.getColumnExpression(calculatedField, model);
    const columnValue = {
      name: calculatedField.referenceName,
      type: calculatedField.type,
      isCalculated: true,
      expression,
      notNull: calculatedField.notNull,
      properties: JSON.parse(calculatedField.properties),
    };
    model.columns.push(columnValue);
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

        const properties = relation.properties
          ? JSON.parse(relation.properties)
          : {};

        return {
          name: name,
          models: [fromModelName, toModelName],
          joinType: joinType,
          condition,
          properties,
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

  protected getColumnExpression(
    column: ModelColumn,
    currentModel?: ModelMDL,
  ): string {
    if (!column.isCalculated) {
      // Provide original column name in expression to MDL if referenceName has converted.
      if (column.sourceColumnName !== column.referenceName) {
        return `"${column.sourceColumnName}"`;
      }
      return '';
    }
    // calculated field
    const lineage = JSON.parse(column.lineage) as number[];
    // lineage = [relationId1, relationId2, ..., columnId]
    const fieldExpression = Object.entries<number>(lineage).reduce(
      (acc, [index, id]) => {
        const isLast = parseInt(index) == lineage.length - 1;
        if (isLast) {
          // id is columnId
          const columnReferenceName = this.relatedColumns.find(
            (relatedColumn) => relatedColumn.id === id,
          )?.referenceName;
          acc.push(`\"${columnReferenceName}\"`);
          return acc;
        }
        // id is relationId
        const usedRelation = this.relatedRelations.find(
          (relatedRelation) => relatedRelation.id === id,
        );
        const relationColumnName = currentModel!.columns.find(
          (c) => c.relationship === usedRelation.name,
        ).name;
        // move to next model
        const nextModelName =
          currentModel.name === usedRelation.fromModelName
            ? usedRelation.toModelName
            : usedRelation.fromModelName;
        const nextModel = this.manifest.models.find(
          (model) => model.name === nextModelName,
        );
        currentModel = nextModel;
        acc.push(relationColumnName);
        return acc;
      },
      [],
    );
    return `${column.aggregation}(${fieldExpression.join('.')})`;
  }

  protected getRelationCondition(relation: RelationInfo): string {
    //TODO phase2: implement the expression for relation condition
    const { fromColumnName, toColumnName, fromModelName, toModelName } =
      relation;
    return `"${fromModelName}".${fromColumnName} = "${toModelName}".${toColumnName}`;
  }

  private buildTableReference(model: Model): TableReference | null {
    const modelProps =
      model.properties && typeof model.properties === 'string'
        ? JSON.parse(model.properties)
        : {};
    if (!modelProps.table) {
      return null;
    }
    return {
      catalog: modelProps.catalog || null,
      schema: modelProps.schema || null,
      table: modelProps.table,
    };
  }
}
