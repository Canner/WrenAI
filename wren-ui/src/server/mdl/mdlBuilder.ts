import { isEmpty, isNil, pickBy } from 'lodash';
import {
  Model,
  ModelColumn,
  ModelNestedColumn,
  Project,
  RelationInfo,
  View,
} from '../repositories';
import { Manifest, ModelMDL } from './type';
import { getLogger } from '@server/utils';
import { getConfig } from '@server/config';
import { IMDLBuilder, MDLBuilderBuildFromOptions } from './mdlBuilderTypes';
import {
  buildManifestDataSource,
  buildTableReference,
  postProcessManifest,
} from './mdlBuilderSupport';

const logger = getLogger('MDLBuilder');
logger.level = 'debug';

const config = getConfig();

// responsible to generate a valid manifest json
export class MDLBuilder implements IMDLBuilder {
  private manifest: Manifest;

  private project: Project;
  private readonly models: Model[];
  private readonly columns: ModelColumn[];
  private readonly nestedColumns: ModelNestedColumn[];
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
      nestedColumns,
      relations,
      views,
      relatedModels,
      relatedColumns,
      relatedRelations,
    } = builderOptions;
    this.project = project;
    this.models = models.sort((a, b) => a.id - b.id);
    this.columns = (columns || []).sort((a, b) => a.id - b.id);
    this.nestedColumns = nestedColumns || [];
    this.relations = (relations || []).sort((a, b) => a.id - b.id);
    this.views = views || [];
    this.relatedModels = relatedModels || [];
    this.relatedColumns = relatedColumns || [];
    this.relatedRelations = relatedRelations || [];

    this.manifest = {};
  }

  public build(): Manifest {
    this.addProject();
    this.addModel();
    this.addNormalField();
    this.addRelation();
    this.addCalculatedField();
    this.addView();
    this.postProcessManifest();
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
      if (model.displayName) {
        properties.displayName = model.displayName;
      }
      const tableReference = buildTableReference(model);

      return {
        name: model.referenceName,
        columns: [],
        tableReference,
        refSql: this.useRustWrenEngine()
          ? null
          : tableReference
            ? null
            : model.refSql,
        cached: model.cached ? true : false,
        refreshTime: model.refreshTime,
        properties: {
          displayName: model.displayName,
          description: properties.description,
        },
        primaryKey: '',
      } as ModelMDL;
    });
  }

  public addView(): void {
    if (!isEmpty(this.manifest.views)) {
      return;
    }
    this.manifest.views = this.views.map((view: View) => {
      const properties = JSON.parse(view.properties || '{}') || {};
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
          viewId: view.id.toString(),
        },
      };
    });
  }

  public addNormalField(): void {
    const manifestModels = this.manifest.models;
    if (!manifestModels || isEmpty(manifestModels)) {
      logger.debug('No model in manifest, should build model first');
      return;
    }
    this.columns
      .filter(({ isCalculated }) => !isCalculated)
      .forEach((column: ModelColumn) => {
        const modelRefName = this.models.find(
          (model: any) => model.id === column.modelId,
        )?.referenceName;
        if (!modelRefName) {
          logger.debug(
            `Build MDL Column Error: can not find model, modelId ${column.modelId}, columnId: ${column.id}`,
          );
          return;
        }
        const model = manifestModels.find(
          (model: any) => model.name === modelRefName,
        );
        if (!model) {
          logger.debug(
            `Build MDL Column Error: model "${modelRefName}" not found in manifest`,
          );
          return;
        }

        if (column.isPk) {
          model.primaryKey = column.referenceName;
        }

        if (!model.columns) {
          model.columns = [];
        }
        const properties = column.properties
          ? JSON.parse(column.properties)
          : {};
        if (column.displayName) {
          properties.displayName = column.displayName;
        }
        if (column.type.includes('STRUCT')) {
          const nestedColumns = this.nestedColumns.filter(
            (nestedColumn) => nestedColumn.columnId === column.id,
          );
          nestedColumns.forEach((column) => {
            if (column.displayName) {
              properties[`nestedDisplayName.${column.sourceColumnName}`] =
                column.displayName;
            }
            if (column.properties?.description) {
              properties[`nestedDescription.${column.sourceColumnName}`] =
                column.properties.description;
            }
          }, {});
        }
        const expression = this.getColumnExpression(column, model);
        model.columns.push({
          name: column.referenceName,
          type: column.type,
          isCalculated: column.isCalculated ? true : false,
          notNull: column.notNull ? true : false,
          expression,
          properties: properties,
        });
      });
  }

  public addCalculatedField(): void {
    const manifestModels = this.manifest.models;
    if (!manifestModels || isEmpty(manifestModels)) {
      logger.debug('No model in manifest, should build model first');
      return;
    }
    this.columns
      .filter(({ isCalculated }) => isCalculated)
      .forEach((column: ModelColumn) => {
        const relatedModel = this.relatedModels.find(
          (model: any) => model.id === column.modelId,
        );
        if (!relatedModel) {
          logger.debug(
            `Build MDL Column Error: related model not found, modelId "${column.modelId}", columnId: "${column.id}"`,
          );
          return;
        }
        const model = manifestModels.find(
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
          notNull: column.notNull ? true : false,
          properties: JSON.parse(column.properties || '{}'),
        };
        model.columns = model.columns || [];
        model.columns.push(columnValue);
      });
  }

  public insertCalculatedField(
    modelName: string,
    calculatedField: ModelColumn,
  ) {
    const manifestModels = this.manifest.models;
    if (!manifestModels) {
      logger.debug('Can not find models in manifest to add calculated field');
      return;
    }

    const model = manifestModels.find((model: any) => model.name === modelName);
    if (!model) {
      logger.debug(`Can not find model "${modelName}" to add calculated field`);
      return;
    }
    model.columns = model.columns || [];
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
      notNull: calculatedField.notNull ? true : false,
      properties: JSON.parse(calculatedField.properties || '{}'),
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
    const dataSource = buildManifestDataSource(this.project);
    if (dataSource) {
      this.manifest.dataSource = dataSource;
    }
  }

  protected addRelationColumn(
    modelName: string,
    columnData: {
      modelReferenceName: string;
      columnReferenceName: string;
      relation: string;
    },
  ) {
    const manifestModels = this.manifest.models;
    if (!manifestModels) {
      logger.debug('Can not find models in manifest to add relation column');
      return;
    }

    const model = manifestModels.find((model: any) => model.name === modelName);
    if (!model) {
      logger.debug(`Can not find model "${modelName}" to add relation column`);
      return;
    }
    if (!model.columns) {
      model.columns = [];
    }
    const modelNameDuplicated = model.columns.find(
      (column: any) => column.name === columnData.modelReferenceName,
    );
    const column = {
      name: modelNameDuplicated
        ? `${columnData.modelReferenceName}_${columnData.columnReferenceName}`
        : columnData.modelReferenceName,
      type: columnData.modelReferenceName,
      properties: {},
      relationship: columnData.relation,
      isCalculated: false,
      notNull: false,
    };
    model.columns.push(column);
  }

  protected getColumnExpression(
    column: ModelColumn,
    currentModel?: Partial<ModelMDL>,
  ): string {
    if (!column.isCalculated) {
      if (column.sourceColumnName !== column.referenceName) {
        return `"${column.sourceColumnName}"`;
      }
      return '';
    }
    if (!column.lineage) {
      return '';
    }
    const lineage = JSON.parse(column.lineage) as number[];
    const fieldExpression = Object.entries<number>(lineage).reduce<string[]>(
      (acc, [index, id]) => {
        const isLast = parseInt(index) == lineage.length - 1;
        if (isLast) {
          const columnReferenceName = this.relatedColumns.find(
            (relatedColumn) => relatedColumn.id === id,
          )?.referenceName;
          acc.push(`\"${columnReferenceName}\"`);
          return acc;
        }
        const usedRelation = this.relatedRelations.find(
          (relatedRelation) => relatedRelation.id === id,
        );
        if (!usedRelation || !currentModel?.columns) {
          return acc;
        }
        const relationColumnName = currentModel!.columns.find(
          (c) => c.relationship === usedRelation.name,
        )?.name;
        if (!relationColumnName) {
          return acc;
        }
        const nextModelName =
          currentModel.name === usedRelation.fromModelName
            ? usedRelation.toModelName
            : usedRelation.fromModelName;
        const nextModel = this.manifest.models?.find(
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
    const { fromColumnName, toColumnName, fromModelName, toModelName } =
      relation;
    return `"${fromModelName}".${fromColumnName} = "${toModelName}".${toColumnName}`;
  }

  private postProcessManifest() {
    if (this.useRustWrenEngine()) {
      postProcessManifest(this.manifest);
    }
  }

  private useRustWrenEngine(): boolean {
    return !!config.experimentalEngineRustVersion;
  }
}

export type {
  IMDLBuilder,
  MDLBuilderBuildFromOptions,
} from './mdlBuilderTypes';
