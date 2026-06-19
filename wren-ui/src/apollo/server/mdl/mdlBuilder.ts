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
logger.level = 'debug';

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
  private invalidCalculatedFields: Array<{
    modelId: number;
    columnId: number;
    reason: string;
  }> = [];

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
  private readonly columnNameAliases = new Map<number, string>();
  private readonly manifestColumnNamesByModel = new Map<string, Set<string>>();
  private readonly manifestColumnNameBySourceByModel = new Map<
    string,
    Map<string, string>
  >();

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

  public build(): Manifest {
    this.invalidCalculatedFields = [];
    this.addProject();
    this.addModel();
    this.addNormalField();
    this.addRelation();
    this.addCalculatedField();
    this.addView();
    this.postProcessManifest();
    this.logInvalidCalculatedFieldSummary();
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
      const properties = this.parseProperties(model.properties);
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
      const properties = this.parseProperties(view.properties);

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
        const properties = this.parseProperties(column.properties);
        // put displayName in properties
        if (column.displayName) {
          properties.displayName = column.displayName;
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
          logger.debug(
            `Skipping duplicate source column "${sourceColumnName}" for model "${model.name}". Reusing manifest column "${existingColumnName}".`,
          );
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
        try {
          // validate manifest.model exist
          const relatedModel = this.relatedModels.find(
            (model: any) => model.id === column.modelId,
          );
          if (!relatedModel) {
            this.recordInvalidCalculatedField(
              column.modelId,
              column.id,
              'can not find related model',
            );
            return;
          }
          const model = this.manifest.models.find(
            (model: any) => model.name === relatedModel.referenceName,
          );
          if (!model) {
            this.recordInvalidCalculatedField(
              column.modelId,
              column.id,
              'can not find model',
            );
            return;
          }
          const columnName = this.getManifestColumnName(column, model);
          const expression = this.getColumnExpression(column, model, columnName);
          if (expression === null) {
            this.recordInvalidCalculatedField(
              column.modelId,
              column.id,
              'invalid calculated field metadata',
            );
            return;
          }
          const columnValue = {
            name: columnName,
            type: column.type,
            isCalculated: true,
            expression,
            notNull: column.notNull ? true : false,
            properties: this.parseProperties(column.properties),
          };
          model.columns.push(columnValue);
        } catch (error: any) {
          this.recordInvalidCalculatedField(
            column.modelId,
            column.id,
            `failed to add calculated field: ${error.message}`,
          );
        }
      });
  }

  public insertCalculatedField(
    modelName: string,
    calculatedField: ModelColumn,
  ) {
    try {
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
      if (expression === null) {
        this.recordInvalidCalculatedField(
          calculatedField.modelId,
          calculatedField.id,
          `insert skipped because metadata is invalid for "${calculatedField.referenceName}"`,
        );
        return;
      }
      const columnValue = {
        name: columnName,
        type: calculatedField.type,
        isCalculated: true,
        expression,
        notNull: calculatedField.notNull ? true : false,
        properties: this.parseProperties(calculatedField.properties),
      };
      model.columns.push(columnValue);
    } catch (error: any) {
      this.recordInvalidCalculatedField(
        calculatedField.modelId,
        calculatedField.id,
        `insert failed for "${calculatedField.referenceName}": ${error.message}`,
      );
    }
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

        const properties = this.parseProperties(relation.properties);

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
    // check if the modelReferenceName is already in the model column
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
  ): string | null {
    if (!column.isCalculated) {
      // columns existed in the data source.
      // Provide original column name in expression to MDL if referenceName has converted.
      if (column.sourceColumnName !== columnReferenceName) {
        return `"${column.sourceColumnName}"`;
      }
      return '';
    }
    // calculated field
    const lineage = this.parseLineage(column.lineage);
    if (isEmpty(lineage) || !column.aggregation) {
      return null;
    }
    // lineage = [relationId1, relationId2, ..., columnId]
    const fieldExpression = lineage.reduce<string[]>((acc, id, index) => {
      const isLast = index === lineage.length - 1;
      if (isLast) {
        // id is columnId
        const relatedColumn = this.relatedColumns.find(
          (relatedColumn) => relatedColumn.id === id,
        );
        const columnReferenceName = relatedColumn
          ? this.columnNameAliases.get(relatedColumn.id) ||
            relatedColumn.referenceName
          : null;
        if (!columnReferenceName) {
          return acc;
        }
        acc.push(`\"${columnReferenceName}\"`);
        return acc;
      }
      // id is relationId
      const usedRelation = this.relatedRelations.find(
        (relatedRelation) => relatedRelation.id === id,
      );
      if (!usedRelation || !currentModel?.columns) {
        return acc;
      }
      const relationColumnName = currentModel.columns.find(
        (c) => c.relationship === usedRelation.name,
      )?.name;
      if (!relationColumnName) {
        return acc;
      }
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
    }, []);
    if (fieldExpression.length !== lineage.length) {
      return null;
    }
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
        ? this.parseProperties(model.properties)
        : {};
    const propertyTableReference =
      typeof modelProps.table === 'string'
        ? this.buildTableReferenceFromTableName(modelProps.table)
        : null;
    const fallbackTableReference = this.buildFallbackTableReference(model);
    const table =
      propertyTableReference?.table ||
      modelProps.table ||
      fallbackTableReference?.table;
    if (!table) {
      return null;
    }
    return {
      catalog:
        propertyTableReference?.catalog ||
        modelProps.catalog ||
        fallbackTableReference?.catalog ||
        null,
      schema:
        propertyTableReference?.schema ||
        modelProps.schema ||
        fallbackTableReference?.schema ||
        null,
      table,
    };
  }

  private buildFallbackTableReference(model: Model): TableReference | null {
    if (!this.useRustWrenEngine() || !model.sourceTableName) {
      return null;
    }

    const sourceTableName = model.sourceTableName.trim();
    const normalizedTableReference =
      this.buildTableReferenceFromTableName(sourceTableName);
    if (normalizedTableReference) {
      return normalizedTableReference;
    }

    return {
      catalog: null,
      schema: null,
      table: sourceTableName,
    };
  }

  private buildTableReferenceFromTableName(
    tableName: string,
  ): TableReference | null {
    const sourceTableName = tableName.trim();
    const catalogQualifiedMatch = sourceTableName.match(
      /^([^.]+)\.([^.]+)\.([^.]+)$/,
    );
    if (catalogQualifiedMatch) {
      const normalizedTableName = this.normalizeDboPrefixedTableName(
        catalogQualifiedMatch[3],
      );
      return {
        catalog: catalogQualifiedMatch[1],
        schema: normalizedTableName.schema || catalogQualifiedMatch[2],
        table: normalizedTableName.table,
      };
    }

    const dotQualifiedMatch = sourceTableName.match(/^([^.]+)\.([^.]+)$/);
    if (dotQualifiedMatch) {
      return {
        catalog: null,
        schema: dotQualifiedMatch[1],
        table: dotQualifiedMatch[2],
      };
    }

    const underscoreQualifiedMatch = sourceTableName.match(/^(dbo)_(.+)$/i);
    if (underscoreQualifiedMatch) {
      return {
        catalog: null,
        schema:
          this.project.type === DataSourceName.MSSQL
            ? underscoreQualifiedMatch[1]
            : null,
        table: underscoreQualifiedMatch[2],
      };
    }

    return null;
  }

  private normalizeDboPrefixedTableName(tableName: string): {
    schema: string | null;
    table: string;
  } {
    const underscoreQualifiedMatch = tableName.match(/^(dbo)_(.+)$/i);
    if (!underscoreQualifiedMatch) {
      return { schema: null, table: tableName };
    }

    return {
      schema:
        this.project.type === DataSourceName.MSSQL
          ? underscoreQualifiedMatch[1]
          : null,
      table: underscoreQualifiedMatch[2],
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
  private parseLineage(lineage?: string): number[] {
    if (!lineage) {
      return [];
    }
    try {
      const parsedLineage = JSON.parse(lineage);
      return Array.isArray(parsedLineage) ? parsedLineage : [];
    } catch (error) {
      logger.debug(`Can not parse calculated field lineage "${lineage}"`);
      return [];
    }
  }
  private parseProperties(properties?: string | null): Record<string, any> {
    if (!properties) {
      return {};
    }
    try {
      const parsed = JSON.parse(properties);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
      logger.debug(`Can not parse properties "${properties}"`);
      return {};
    }
  }
  private recordInvalidCalculatedField(
    modelId: number,
    columnId: number,
    reason: string,
  ) {
    this.invalidCalculatedFields.push({ modelId, columnId, reason });
  }
  private logInvalidCalculatedFieldSummary() {
    if (this.invalidCalculatedFields.length === 0) {
      return;
    }
    const preview = this.invalidCalculatedFields
      .slice(0, 10)
      .map(
        ({ modelId, columnId, reason }) =>
          `modelId="${modelId}", columnId="${columnId}", reason="${reason}"`,
      )
      .join('; ');
    logger.warn(
      `Skipped ${this.invalidCalculatedFields.length} invalid calculated field(s) while building MDL. ${preview}${this.invalidCalculatedFields.length > 10 ? '; ...' : ''}`,
    );
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
