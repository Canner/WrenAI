import { BigQueryOptions } from '@google-cloud/bigquery';
import {
  BQColumnResponse,
  BQConnector,
  BQConstraintResponse,
  BQListTableOptions,
} from '../connectors/bqConnector';
import {
  DataSource,
  DataSourceName,
  IContext,
  RelationData,
  RelationType,
} from '../types';
import { getLogger, Encryptor } from '@server/utils';
import { Model, ModelColumn, Project } from '../repositories';

const logger = getLogger('DataSourceResolver');
logger.level = 'debug';

export enum OnboardingStatusEnum {
  NOT_STARTED = 'NOT_STARTED',
  DATASOURCE_SAVED = 'DATASOURCE_SAVED',
  ONBOARDING_FINISHED = 'ONBOARDING_FINISHED',
  WITH_SAMPLE_DATASET = 'WITH_SAMPLE_DATASET',
}

export class ProjectResolver {
  constructor() {
    this.saveDataSource = this.saveDataSource.bind(this);
    this.listDataSourceTables = this.listDataSourceTables.bind(this);
    this.saveTables = this.saveTables.bind(this);
    this.autoGenerateRelation = this.autoGenerateRelation.bind(this);
    this.saveRelations = this.saveRelations.bind(this);
    this.getOnboardingStatus = this.getOnboardingStatus.bind(this);
  }

  public async getOnboardingStatus(_root: any, _arg: any, ctx: IContext) {
    let project: Project | null;
    try {
      project = await ctx.projectRepository.getCurrentProject();
    } catch (_err: any) {
      return {
        status: OnboardingStatusEnum.NOT_STARTED,
      };
    }
    const { id, sampleDataset } = project;
    if (sampleDataset) {
      return {
        status: OnboardingStatusEnum.WITH_SAMPLE_DATASET,
      };
    }
    const models = await ctx.modelRepository.findAllBy({ projectId: id });
    if (!models.length) {
      return {
        status: OnboardingStatusEnum.DATASOURCE_SAVED,
      };
    } else {
      return {
        status: OnboardingStatusEnum.ONBOARDING_FINISHED,
      };
    }
  }

  public async saveDataSource(
    _root: any,
    args: {
      data: DataSource;
    },
    ctx: IContext,
  ) {
    const { type, properties } = args.data;
    if (type === DataSourceName.BIG_QUERY) {
      await this.saveBigQueryDataSource(properties, ctx);
      return args.data;
    }
  }

  public async listDataSourceTables(_root: any, _arg, ctx: IContext) {
    const project = await ctx.projectService.getCurrentProject();
    const filePath = await ctx.projectService.getCredentialFilePath(project);
    const connector = await this.getBQConnector(project, filePath);
    const listTableOptions: BQListTableOptions = {
      dataset: project.dataset,
      format: true,
    };
    return await connector.listTables(listTableOptions);
  }

  public async saveTables(
    _root: any,
    arg: {
      data: { tables: string[] };
    },
    ctx: IContext,
  ) {
    const tables = arg.data.tables;

    // get current project
    const project = await ctx.projectService.getCurrentProject();
    const filePath = await ctx.projectService.getCredentialFilePath(project);

    // get columns with descriptions
    const connector = await this.getBQConnector(project, filePath);
    const listTableOptions: BQListTableOptions = {
      dataset: project.dataset,
      format: false,
    };
    const dataSourceColumns = await connector.listTables(listTableOptions);
    // create models
    const id = project.id;
    const tableDescriptions = dataSourceColumns
      .filter((col: BQColumnResponse) => col.table_description)
      .reduce((acc, column: BQColumnResponse) => {
        acc[column.table_name] = column.table_description;
        return acc;
      }, {});
    const models = await this.createModels(tables, id, ctx, tableDescriptions);
    // create columns
    const columns = await this.createAllColumnsInDataSource(
      tables,
      models,
      dataSourceColumns as BQColumnResponse[],
      ctx,
    );

    return { models, columns };
  }

  public async autoGenerateRelation(_root: any, _arg: any, ctx: IContext) {
    const project = await ctx.projectService.getCurrentProject();
    const filePath = await ctx.projectService.getCredentialFilePath(project);
    const models = await ctx.modelRepository.findAllBy({
      projectId: project.id,
    });

    const connector = await this.getBQConnector(project, filePath);
    const listConstraintOptions = {
      dataset: project.dataset,
    };
    const constraints = await connector.listConstraints(listConstraintOptions);
    logger.log('constraints', constraints);
    const modelIds = models.map((m) => m.id);
    const columns =
      await ctx.modelColumnRepository.findColumnsByModelIds(modelIds);
    const relations = this.analysisRelation(constraints, models, columns);
    return models.map(({ id, sourceTableName }) => ({
      id,
      name: sourceTableName,
      relations: relations.filter((relation) => relation.fromModel === id),
    }));
  }

  public async saveRelations(
    _root: any,
    arg: { data: { relations: RelationData[] } },
    ctx: IContext,
  ) {
    const { relations } = arg.data;
    const project = await ctx.projectService.getCurrentProject();

    const models = await ctx.modelRepository.findAllBy({
      projectId: project.id,
    });

    const columnIds = relations
      .map(({ fromColumn, toColumn }) => [fromColumn, toColumn])
      .flat();
    const columns = await ctx.modelColumnRepository.findColumnsByIds(columnIds);
    const relationValues = relations.map((relation) => {
      const fromColumn = columns.find(
        (column) => column.id === relation.fromColumn,
      );
      if (!fromColumn) {
        throw new Error(`Column not found, column Id ${relation.fromColumn}`);
      }
      const toColumn = columns.find(
        (column) => column.id === relation.toColumn,
      );
      if (!toColumn) {
        throw new Error(`Column not found, column Id  ${relation.toColumn}`);
      }
      const relationName = this.generateRelationName(relation, models);
      return {
        projectId: project.id,
        name: relationName,
        fromColumnId: relation.fromColumn,
        toColumnId: relation.toColumn,
        joinType: relation.type,
      };
    });

    const savedRelations = await Promise.all(
      relationValues.map((relation) =>
        ctx.relationRepository.createOne(relation),
      ),
    );
    return savedRelations;
  }

  private analysisRelation(
    constraints: BQConstraintResponse[],
    models: Model[],
    columns: ModelColumn[],
  ): RelationData[] {
    const relations = [];
    for (const constraint of constraints) {
      const {
        constraintTable,
        constraintColumn,
        constraintedTable,
        constraintedColumn,
      } = constraint;
      // validate tables and columns exists in our models and model columns
      const fromModel = models.find(
        (m) => m.sourceTableName === constraintTable,
      );
      const toModel = models.find(
        (m) => m.sourceTableName === constraintedTable,
      );
      if (!fromModel || !toModel) {
        continue;
      }
      const fromColumn = columns.find(
        (c) =>
          c.modelId === fromModel.id && c.sourceColumnName === constraintColumn,
      );
      const toColumn = columns.find(
        (c) =>
          c.modelId === toModel.id && c.sourceColumnName === constraintedColumn,
      );
      if (!fromColumn || !toColumn) {
        continue;
      }
      // create relation
      const relation = {
        // upper case the first letter of the sourceTableName
        name:
          fromModel.sourceTableName.charAt(0).toUpperCase() +
          fromModel.sourceTableName.slice(1) +
          toModel.sourceTableName.charAt(0).toUpperCase() +
          toModel.sourceTableName.slice(1),
        fromModel: fromModel.id,
        fromColumn: fromColumn.id,
        toModel: toModel.id,
        toColumn: toColumn.id,
        // TODO: add join type
        type: RelationType.ONE_TO_MANY,
      };
      relations.push(relation);
    }
    return relations;
  }

  private async getBQConnector(project: Project, filePath: string) {
    // fetch tables
    const { location, projectId } = project;
    const connectionOption: BigQueryOptions = {
      location,
      projectId,
      keyFilename: filePath,
    };
    return new BQConnector(connectionOption);
  }

  private async createAllColumnsInDataSource(
    tables: string[],
    models: Model[],
    dataSourceColumns: BQColumnResponse[],
    ctx: IContext,
  ) {
    const columnValues = tables.reduce((acc, tableName) => {
      const modelId = models.find((m) => m.sourceTableName === tableName)?.id;
      if (!modelId) {
        throw new Error('Model not found');
      }
      const tableColumns = dataSourceColumns.filter(
        (col) => col.table_name === tableName,
      );
      for (const tableColumn of tableColumns) {
        const columnName = tableColumn.column_name;
        const columnValue = {
          modelId,
          isCalculated: false,
          displayName: columnName,
          sourceColumnName: columnName,
          referenceName: columnName,
          type: tableColumn?.data_type || 'string',
          notNull: tableColumn.is_nullable.toLocaleLowerCase() !== 'yes',
          isPk: false,
          properties: JSON.stringify({
            description: tableColumn.column_description,
          }),
        } as Partial<ModelColumn>;
        acc.push(columnValue);
      }
      return acc;
    }, []);
    const columns = await Promise.all(
      columnValues.map(
        async (column) => await ctx.modelColumnRepository.createOne(column),
      ),
    );
    return columns;
  }

  private async createModels(
    tables: string[],
    id: number,
    ctx: IContext,
    tableDescriptions: { [key: string]: string },
  ) {
    const modelValues = tables.map((tableName) => {
      const description = tableDescriptions[tableName];
      const model = {
        projectId: id,
        displayName: tableName, //use table name as displayName, referenceName and tableName
        referenceName: tableName,
        sourceTableName: tableName,
        refSql: `select * from ${tableName}`,
        cached: false,
        refreshTime: null,
        properties: JSON.stringify({ description }),
      } as Partial<Model>;
      return model;
    });

    const models = await Promise.all(
      modelValues.map(
        async (modelValue) => await ctx.modelRepository.createOne(modelValue),
      ),
    );
    return models;
  }

  private async saveBigQueryDataSource(properties: any, ctx: IContext) {
    const { displayName, location, projectId, dataset, credentials } =
      properties;
    const { config } = ctx;
    let filePath = '';
    // check DataSource is valid and can connect to it
    filePath = ctx.projectService.writeCredentialsFile(
      credentials,
      config.persistCredentialDir,
    );
    const connectionOption: BigQueryOptions = {
      location,
      projectId,
      keyFilename: filePath,
    };
    const connector = new BQConnector(connectionOption);
    const connected = await connector.connect();
    if (!connected) {
      throw new Error('Cannot connect to DataSource');
    }
    // check can list dataset table
    try {
      await connector.listTables({ dataset });
    } catch (_e) {
      throw new Error('Cannot list tables in dataset');
    }
    // save DataSource to database
    const encryptor = new Encryptor(config);
    const encryptedCredentials = encryptor.encrypt(credentials);

    // TODO: add displayName, schema, catalog to the DataSource, depends on the MDL structure
    const project = await ctx.projectRepository.createOne({
      displayName,
      schema: 'tbd',
      catalog: 'tbd',
      type: DataSourceName.BIG_QUERY,
      projectId,
      location,
      dataset,
      credentials: encryptedCredentials,
    });
    return project;
  }

  private generateRelationName(relation: RelationData, models: Model[]) {
    const fromModel = models.find((m) => m.id === relation.fromModel);
    const toModel = models.find((m) => m.id === relation.toModel);
    if (!fromModel || !toModel) {
      throw new Error('Model not found');
    }
    return (
      fromModel.sourceTableName.charAt(0).toUpperCase() +
      fromModel.sourceTableName.slice(1) +
      toModel.sourceTableName.charAt(0).toUpperCase() +
      toModel.sourceTableName.slice(1)
    );
  }
}
