import { isEmpty, isNil, pickBy } from 'lodash';
import {
  Model,
  ModelColumn,
  ModelNestedColumn,
  Project,
  RelationInfo,
  View,
} from '../repositories';
import {
  ColumnMDL,
  Manifest,
  ModelMDL,
  TableReference,
  WrenEngineDataSourceType,
} from './type';
import { getLogger } from '@server/utils';
import { getConfig } from '@server/config';
import { DataSourceName } from '../types';
import { getUniqueReferenceName } from '../utils/model';

const logger = getLogger('MDLBuilder');

const config = getConfig();

export interface MDLBuilderBuildFromOptions {
  project: Project;
  models: Model[];
  columns?: ModelColumn[];
  nestedColumns?: ModelNestedColumn[];
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
  private skippedDuplicateColumns = new Map<string, Set<string>>();
  private readonly columnNameAliases = new Map<number, string>();
  private readonly manifestColumnNamesByModel = new Map<string, Set<string>>();
  private readonly manifestColumnNameBySourceByModel = new Map<
    string,
    Map<string, string>
  >();

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
    this.columns = columns.sort((a, b) => a.id - b.id);
    this.nestedColumns = nestedColumns;
    this.relations = relations.sort((a, b) => a.id - b.id);
    this.views = views || [];
    this.relatedModels = relatedModels;
    this.relatedColumns = relatedColumns;
    this.relatedRelations = relatedRelations;

    // init manifest
    this.manifest = {};
  }

  private recordSkippedDuplicateColumn(modelName: string, columnName: string) {
    const columns =
      this.skippedDuplicateColumns.get(modelName) || new Set<string>();
    columns.add(columnName);
    this.skippedDuplicateColumns.set(modelName, columns);
  }

  private logSkippedDuplicateColumns() {
    if (this.skippedDuplicateColumns.size === 0) {
      return;
    }

    const duplicateCount = [...this.skippedDuplicateColumns.values()].reduce(
      (count, columns) => count + columns.size,
      0,
    );
    const examples = [...this.skippedDuplicateColumns.entries()]
      .slice(0, 5)
      .map(
        ([modelName, columns]) =>
          `${modelName}: ${[...columns].slice(0, 5).join(', ')}`,
      )
      .join('; ');

    logger.debug(
      `Skipped ${duplicateCount} duplicated MDL columns across ${this.skippedDuplicateColumns.size} models. Examples: ${examples}`,
    );
  }

  public build(): Manifest {
    this.skippedDuplicateColumns.clear();
    this.columnNameAliases.clear();
    this.manifestColumnNamesByModel.clear();
    this.manifestColumnNameBySourceByModel.clear();
    this.addProject();
    this.addModel();
    this.addNormalField();
    this.addRelation();
    this.addCalculatedField();
    this.addView();
    this.postProcessManifest();
    this.logSkippedDuplicateColumns();
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

      const modelMdl = {
        name: model.referenceName,
        columns: [],
        tableReference,
        // can only have one of refSql or tableReference
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
        primaryKey: '', // will be modified in addColumn
      } as ModelMDL;

      if (tableReference && this.hasDuplicateSourceColumns(model.id)) {
        const refSql = this.buildDedupedTableReferenceSql(
          model.id,
          modelMdl,
          tableReference,
        );
        if (refSql) {
          logger.debug(
            `Using deduped explicit projection for model "${model.referenceName}" because its source table contains duplicate column names.`,
          );
          modelMdl.tableReference = null;
          modelMdl.refSql = refSql;
        }
      }

      return modelMdl;
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
        if (column.sourceColumnName) {
          properties.sourceColumnName = column.sourceColumnName;
        }
        // put nested columns in properties
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
        const sourceColumnName = column.sourceColumnName || column.referenceName;
        const sourceColumnNames = this.getManifestSourceColumnNameMap(model);
        const existingColumnName = sourceColumnNames.get(
          sourceColumnName.toLowerCase(),
        );
        if (existingColumnName) {
          this.columnNameAliases.set(column.id, existingColumnName);
          if (column.isPk) {
            model.primaryKey = existingColumnName;
          }
          this.recordSkippedDuplicateColumn(modelRefName, sourceColumnName);
          return;
        }

        const columnName = this.getManifestColumnName(column, model);
        sourceColumnNames.set(sourceColumnName.toLowerCase(), columnName);

        // modify model primary key
        if (column.isPk) {
          model.primaryKey = columnName;
        }

        const expression = this.getColumnExpression(column, model, columnName);
        model.columns.push({
          name: columnName,
          type: column.type,
          isCalculated: column.isCalculated ? true : false,
          notNull: column.notNull ? true : false,
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
        const columnName = this.getManifestColumnName(column, model);
        const expression = this.getColumnExpression(column, model, columnName);
        const columnValue = {
          name: columnName,
          type: column.type,
          isCalculated: true,
          expression,
          notNull: column.notNull ? true : false,
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
    const columnName = this.getManifestColumnName(calculatedField, model);
    const expression = this.getColumnExpression(
      calculatedField,
      model,
      columnName,
    );
    const columnValue = {
      name: columnName,
      type: calculatedField.type,
      isCalculated: true,
      expression,
      notNull: calculatedField.notNull ? true : false,
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
          fromColumnId,
          toModelName,
          toColumnName,
          toColumnId,
        } = relation;
        const condition = this.getRelationCondition(relation);
        this.addRelationColumn(fromModelName, {
          modelReferenceName: toModelName,
          columnReferenceName:
            this.columnNameAliases.get(toColumnId) || toColumnName,
          relation: name,
        });
        this.addRelationColumn(toModelName, {
          modelReferenceName: fromModelName,
          columnReferenceName:
            this.columnNameAliases.get(fromColumnId) || fromColumnName,
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
    const dataSource = this.buildDataSource();
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
    const modelColumnNames = this.getManifestColumnNames(model);
    const modelNameDuplicated = modelColumnNames.has(
      columnData.modelReferenceName.toLowerCase(),
    );
    const columnName = getUniqueReferenceName(
      modelNameDuplicated
        ? `${columnData.modelReferenceName}_${columnData.columnReferenceName}`
        : columnData.modelReferenceName,
      modelColumnNames,
    );
    const column = {
      name: columnName,
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
    currentModel?: Partial<ModelMDL>,
    columnReferenceName = column.referenceName,
  ): string {
    if (!column.isCalculated) {
      // columns existed in the data source.
      // Provide original column name in expression to MDL if referenceName has converted.
      const sourceColumnName = column.sourceColumnName || column.referenceName;
      if (sourceColumnName !== columnReferenceName) {
        return `"${sourceColumnName}"`;
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
          const relatedColumn = this.relatedColumns.find(
            (relatedColumn) => relatedColumn.id === id,
          );
          const columnReferenceName = relatedColumn
            ? this.columnNameAliases.get(relatedColumn.id) ||
              relatedColumn.referenceName
            : null;
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
    const {
      fromColumnId,
      fromColumnName,
      toColumnId,
      toColumnName,
      fromModelName,
      toModelName,
    } = relation;
    const fromColumnReferenceName =
      this.columnNameAliases.get(fromColumnId) || fromColumnName;
    const toColumnReferenceName =
      this.columnNameAliases.get(toColumnId) || toColumnName;
    return `"${fromModelName}".${fromColumnReferenceName} = "${toModelName}".${toColumnReferenceName}`;
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

  private hasDuplicateSourceColumns(modelId: number): boolean {
    const sourceColumnNames = new Set<string>();
    for (const column of this.columns.filter(
      ({ isCalculated, modelId: columnModelId }) =>
        !isCalculated && columnModelId === modelId,
    )) {
      const sourceColumnName = (
        column.sourceColumnName || column.referenceName
      ).toLowerCase();
      if (sourceColumnNames.has(sourceColumnName)) {
        return true;
      }
      sourceColumnNames.add(sourceColumnName);
    }
    return false;
  }

  private buildDedupedTableReferenceSql(
    modelId: number,
    model: Partial<ModelMDL>,
    tableReference: TableReference,
  ): string | null {
    const sourceColumnNames = new Map<string, string>();
    const projections: string[] = [];

    this.columns
      .filter(
        ({ isCalculated, modelId: columnModelId }) =>
          !isCalculated && columnModelId === modelId,
      )
      .forEach((column) => {
        const sourceColumnName = column.sourceColumnName || column.referenceName;
        const normalizedSourceColumnName = sourceColumnName.toLowerCase();
        const existingColumnName = sourceColumnNames.get(
          normalizedSourceColumnName,
        );

        if (existingColumnName) {
          this.columnNameAliases.set(column.id, existingColumnName);
          return;
        }

        const columnName = this.getManifestColumnName(column, model);
        sourceColumnNames.set(normalizedSourceColumnName, columnName);
        const sourceExpression = this.quoteSqlIdentifier(sourceColumnName);
        projections.push(
          sourceColumnName === columnName
            ? sourceExpression
            : `${sourceExpression} AS ${this.quoteSqlIdentifier(columnName)}`,
        );
      });

    if (!projections.length) {
      return null;
    }

    const tableParts = [
      tableReference.catalog,
      tableReference.schema,
      tableReference.table,
    ].filter((part): part is string => Boolean(part));
    return `SELECT ${projections.join(', ')} FROM ${tableParts
      .map((part) => this.quoteSqlIdentifier(part))
      .join('.')}`;
  }

  private quoteSqlIdentifier(identifier: string): string {
    return `"${identifier.replace(/"/g, '""')}"`;
  }

  private getManifestColumnName(
    column: ModelColumn,
    model: Partial<ModelMDL>,
  ): string {
    if (this.columnNameAliases.has(column.id)) {
      return this.columnNameAliases.get(column.id)!;
    }

    const columnName = getUniqueReferenceName(
      column.referenceName,
      this.getManifestColumnNames(model),
    );
    this.columnNameAliases.set(column.id, columnName);
    return columnName;
  }

  private getManifestColumnNames(model: Partial<ModelMDL>): Set<string> {
    const modelName = model.name || '';
    if (!this.manifestColumnNamesByModel.has(modelName)) {
      const existingColumns = (model.columns || []) as ColumnMDL[];
      this.manifestColumnNamesByModel.set(
        modelName,
        new Set(existingColumns.map((column) => column.name.toLowerCase())),
      );
    }
    return this.manifestColumnNamesByModel.get(modelName)!;
  }

  private getManifestSourceColumnNameMap(
    model: Partial<ModelMDL>,
  ): Map<string, string> {
    const modelName = model.name || '';
    if (!this.manifestColumnNameBySourceByModel.has(modelName)) {
      this.manifestColumnNameBySourceByModel.set(modelName, new Map());
    }
    return this.manifestColumnNameBySourceByModel.get(modelName)!;
  }

  private postProcessManifest() {
    if (this.useRustWrenEngine()) {
      // 1. remove all the key that the value is null
      this.manifest.models = this.manifest.models?.map((model) => {
        model.columns.map((column) => {
          column.properties = pickBy(
            column.properties,
            (value) => value !== null,
          );
          return column;
        });
        return pickBy(model, (value) => value !== null);
      });
      this.manifest.views = this.manifest.views?.map((view) => {
        return pickBy(view, (value) => value !== null);
      });
      this.manifest.relationships = this.manifest.relationships?.map(
        (relationship) => {
          return pickBy(relationship, (value) => value !== null);
        },
      );
      this.manifest.enumDefinitions = this.manifest.enumDefinitions?.map(
        (enumDefinition) => {
          return pickBy(enumDefinition, (value) => value !== null);
        },
      );
      // 2. remove expression if it's empty string
      this.manifest.models?.forEach((model) => {
        model.columns?.forEach((column) => {
          if (column.expression === '') {
            delete column.expression;
          }
        });
      });
    }
  }
  private useRustWrenEngine(): boolean {
    return !!config.experimentalEngineRustVersion;
  }
  private buildDataSource(): WrenEngineDataSourceType {
    const type = this.project.type;
    if (!type) {
      return;
    }
    switch (type) {
      case DataSourceName.ATHENA:
        return WrenEngineDataSourceType.ATHENA;
      case DataSourceName.BIG_QUERY:
        return WrenEngineDataSourceType.BIGQUERY;
      case DataSourceName.DUCKDB:
        return WrenEngineDataSourceType.DUCKDB;
      case DataSourceName.POSTGRES:
        return WrenEngineDataSourceType.POSTGRES;
      case DataSourceName.MYSQL:
        return WrenEngineDataSourceType.MYSQL;
      case DataSourceName.ORACLE:
        return WrenEngineDataSourceType.ORACLE;
      case DataSourceName.MSSQL:
        return WrenEngineDataSourceType.MSSQL;
      case DataSourceName.CLICK_HOUSE:
        return WrenEngineDataSourceType.CLICKHOUSE;
      case DataSourceName.TRINO:
        return WrenEngineDataSourceType.TRINO;
      case DataSourceName.SNOWFLAKE:
        return WrenEngineDataSourceType.SNOWFLAKE;
      case DataSourceName.REDSHIFT:
        return WrenEngineDataSourceType.REDSHIFT;
      case DataSourceName.DATABRICKS:
        return WrenEngineDataSourceType.DATABRICKS;
      default:
        throw new Error(
          `Unsupported data source type: ${type} found when building manifest`,
        );
    }
  }
}
