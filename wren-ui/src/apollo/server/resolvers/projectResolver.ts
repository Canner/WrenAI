import {
  AnalysisRelationInfo,
  DataSource,
  DataSourceName,
  DataSourceProperties,
  IContext,
  RelationData,
  RelationType,
  SampleDatasetData,
} from '../types';
import { getLogger, replaceInvalidReferenceName, trim } from '@server/utils';
import {
  DUCKDB_CONNECTION_INFO,
  Model,
  ModelColumn,
  Project,
} from '../repositories';
import {
  SampleDatasetName,
  SampleDatasetRelationship,
  buildInitSql,
  getRelations,
  sampleDatasets,
} from '@server/data';
import { snakeCase } from 'lodash';
import { CompactTable, ProjectData } from '../services';
import { replaceAllowableSyntax } from '../utils/regex';
import { DuckDBPrepareOptions } from '@server/adaptors/wrenEngineAdaptor';
import DataSourceSchemaDetector, {
  SchemaChangeType,
} from '@server/managers/dataSourceSchemaDetector';
import { encryptConnectionInfo } from '../dataSource';
import { TelemetryEvent } from '../telemetry/telemetry';

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
    this.getSettings = this.getSettings.bind(this);
    this.resetCurrentProject = this.resetCurrentProject.bind(this);
    this.saveDataSource = this.saveDataSource.bind(this);
    this.updateDataSource = this.updateDataSource.bind(this);
    this.listDataSourceTables = this.listDataSourceTables.bind(this);
    this.saveTables = this.saveTables.bind(this);
    this.autoGenerateRelation = this.autoGenerateRelation.bind(this);
    this.saveRelations = this.saveRelations.bind(this);
    this.getOnboardingStatus = this.getOnboardingStatus.bind(this);
    this.startSampleDataset = this.startSampleDataset.bind(this);
    this.triggerDataSourceDetection =
      this.triggerDataSourceDetection.bind(this);
    this.getSchemaChange = this.getSchemaChange.bind(this);
  }

  public async getSettings(_root: any, _arg: any, ctx: IContext) {
    const project = await ctx.projectService.getCurrentProject();
    const generalConnectionInfo =
      ctx.projectService.getGeneralConnectionInfo(project);
    const dataSourceType = project.type;

    return {
      productVersion: ctx.config.wrenProductVersion || '',
      dataSource: {
        type: dataSourceType,
        properties: {
          displayName: project.displayName,
          ...generalConnectionInfo,
        } as DataSourceProperties,
        sampleDataset: project.sampleDataset,
      },
    };
  }

  public async resetCurrentProject(_root: any, _arg: any, ctx: IContext) {
    let project;
    try {
      project = await ctx.projectService.getCurrentProject();
    } catch {
      // no project found
      return true;
    }
    const eventName = TelemetryEvent.SETTING_RESET_PROJECT;
    try {
      const id = project.id;
      await ctx.schemaChangeRepository.deleteAllBy({ projectId: id });
      await ctx.deployService.deleteAllByProjectId(id);
      await ctx.askingService.deleteAllByProjectId(id);
      await ctx.modelService.deleteAllViewsByProjectId(id);
      await ctx.modelService.deleteAllModelsByProjectId(id);
      await ctx.projectService.deleteProject(id);

      // telemetry
      ctx.telemetry.sendEvent(eventName, {
        projectId: id,
        dataSourceType: project.type,
      });
    } catch (err: any) {
      ctx.telemetry.sendEvent(
        eventName,
        { dataSourceType: project.type, error: err.message },
        err.extensions?.service,
        false,
      );
    }

    return true;
  }

  public async startSampleDataset(
    _root: any,
    _arg: { data: SampleDatasetData },
    ctx: IContext,
  ) {
    const { name } = _arg.data;
    const dataset = sampleDatasets[snakeCase(name)];
    if (!dataset) {
      throw new Error('Sample dataset not found');
    }
    if (!(name in SampleDatasetName)) {
      throw new Error('Invalid sample dataset name');
    }
    const eventName = TelemetryEvent.CONNECTION_START_SAMPLE_DATASET;
    const eventProperties = {
      datasetName: name,
    };
    try {
      // create duckdb datasource
      const initSql = buildInitSql(name as SampleDatasetName);
      const duckdbDatasourceProperties = {
        initSql,
        extensions: [],
        configurations: {},
      };
      await this.saveDataSource(
        _root,
        {
          data: {
            type: DataSourceName.DUCKDB,
            properties: duckdbDatasourceProperties,
          } as DataSource,
        },
        ctx,
      );
      const project = await ctx.projectService.getCurrentProject();

      // list all the tables in the data source
      const tables = await this.listDataSourceTables(_root, _arg, ctx);
      const tableNames = tables.map((table) => table.name);

      // save tables as model and modelColumns
      await this.overwriteModelsAndColumns(tableNames, ctx, project);

      await ctx.modelService.updatePrimaryKeys(dataset.tables);
      await ctx.modelService.batchUpdateModelProperties(dataset.tables);
      await ctx.modelService.batchUpdateColumnProperties(dataset.tables);

      // save relations
      const relations = getRelations(name as SampleDatasetName);
      const models = await ctx.modelRepository.findAll();
      const columns = await ctx.modelColumnRepository.findAll();
      const mappedRelations = this.buildRelationInput(
        relations,
        models,
        columns,
      );
      await ctx.modelService.saveRelations(mappedRelations);

      // mark current project as using sample dataset
      await ctx.projectRepository.updateOne(project.id, {
        sampleDataset: name,
      });
      await this.deploy(ctx);
      // telemetry
      ctx.telemetry.sendEvent(eventName, eventProperties);
      return { name };
    } catch (err: any) {
      ctx.telemetry.sendEvent(
        eventName,
        { ...eventProperties, error: err.message },
        err.extensions?.service,
        false,
      );
      throw err;
    }
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
    // Currently only can create one project
    await this.resetCurrentProject(_root, args, ctx);

    const { displayName, ...connectionInfo } = properties;
    const project = await ctx.projectService.createProject({
      displayName,
      type,
      connectionInfo,
    } as ProjectData);
    logger.debug(`Project created `);
    const eventName = TelemetryEvent.CONNECTION_SAVE_DATA_SOURCE;
    const eventProperties = {
      dataSourceType: type,
    };

    // try to connect to the data source
    try {
      // handle duckdb connection
      if (type === DataSourceName.DUCKDB) {
        connectionInfo as DUCKDB_CONNECTION_INFO;
        await this.buildDuckDbEnvironment(ctx, {
          initSql: connectionInfo.initSql,
          extensions: connectionInfo.extensions,
          configurations: connectionInfo.configurations,
        });
      } else {
        // handle other data source
        await ctx.projectService.getProjectDataSourceTables(project);
        logger.debug(`Data source tables fetched`);
      }
      // telemetry
      ctx.telemetry.sendEvent(eventName, eventProperties);
    } catch (err) {
      logger.error(
        'Failed to get project tables',
        JSON.stringify(err, null, 2),
      );
      await ctx.projectRepository.deleteOne(project.id);
      ctx.telemetry.sendEvent(
        eventName,
        { eventProperties, error: err.message },
        err.extensions?.service,
        false,
      );
      throw err;
    }

    return {
      type: project.type,
      properties: {
        displayName: project.displayName,
        ...ctx.projectService.getGeneralConnectionInfo(project),
      },
    };
  }

  public async updateDataSource(
    _root: any,
    args: { data: DataSource },
    ctx: IContext,
  ) {
    const { properties } = args.data;
    const { displayName, ...connectionInfo } = properties;
    const project = await ctx.projectService.getCurrentProject();
    const dataSourceType = project.type;

    // only new connection info needed to encrypt
    const toUpdateConnectionInfo = encryptConnectionInfo(
      dataSourceType,
      connectionInfo as any,
    );

    if (dataSourceType === DataSourceName.DUCKDB) {
      // prepare duckdb environment in wren-engine
      const { initSql, extensions, configurations } =
        toUpdateConnectionInfo as DUCKDB_CONNECTION_INFO;
      await this.buildDuckDbEnvironment(ctx, {
        initSql,
        extensions,
        configurations,
      });
    } else {
      const updatedProject = {
        ...project,
        displayName,
        connectionInfo: {
          ...project.connectionInfo,
          ...toUpdateConnectionInfo,
        },
      } as Project;

      await ctx.projectService.getProjectDataSourceTables(updatedProject);
      logger.debug(`Data source tables fetched`);
    }
    const updatedProject = await ctx.projectRepository.updateOne(project.id, {
      displayName,
      connectionInfo: { ...project.connectionInfo, ...toUpdateConnectionInfo },
    });
    return {
      type: updatedProject.type,
      properties: {
        displayName: updatedProject.displayName,
        ...ctx.projectService.getGeneralConnectionInfo(updatedProject),
      },
    };
  }

  public async listDataSourceTables(_root: any, _arg, ctx: IContext) {
    return await ctx.projectService.getProjectDataSourceTables();
  }

  public async saveTables(
    _root: any,
    arg: {
      data: { tables: string[] };
    },
    ctx: IContext,
  ) {
    const eventName = TelemetryEvent.CONNECTION_SAVE_TABLES;

    // get current project
    const project = await ctx.projectService.getCurrentProject();
    try {
      // delete existing models and columns
      const { models, columns } = await this.overwriteModelsAndColumns(
        arg.data.tables,
        ctx,
        project,
      );
      // telemetry
      ctx.telemetry.sendEvent(eventName, {
        dataSourceType: project.type,
        tablesCount: models.length,
        columnsCount: columns.length,
      });

      // async deploy to wren-engine and ai service
      this.deploy(ctx);
      return { models: models, columns };
    } catch (err: any) {
      ctx.telemetry.sendEvent(
        eventName,
        { dataSourceType: project.type, error: err.message },
        err.extensions?.service,
        false,
      );
      throw err;
    }
  }

  public async autoGenerateRelation(_root: any, _arg: any, ctx: IContext) {
    const project = await ctx.projectService.getCurrentProject();

    // get models and columns
    const models = await ctx.modelRepository.findAllBy({
      projectId: project.id,
    });
    const modelIds = models.map((m) => m.id);
    const columns =
      await ctx.modelColumnRepository.findColumnsByModelIds(modelIds);
    const constraints =
      await ctx.projectService.getProjectSuggestedConstraint(project);

    // generate relation
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
      const relation: AnalysisRelationInfo = {
        // upper case the first letter of the sourceTableName
        name: constraint.constraintName,
        fromModelId: fromModel.id,
        fromModelReferenceName: fromModel.referenceName,
        fromColumnId: fromColumn.id,
        fromColumnReferenceName: fromColumn.referenceName,
        toModelId: toModel.id,
        toModelReferenceName: toModel.referenceName,
        toColumnId: toColumn.id,
        toColumnReferenceName: toColumn.referenceName,
        // TODO: add join type
        type: RelationType.ONE_TO_MANY,
      };
      relations.push(relation);
    }
    // group by model
    return models.map(({ id, displayName, referenceName }) => ({
      id,
      displayName,
      referenceName,
      relations: relations.filter(
        (relation) =>
          relation.fromModelId === id &&
          // exclude self-referential relationship
          relation.toModelId !== relation.fromModelId,
      ),
    }));
  }

  public async saveRelations(
    _root: any,
    arg: { data: { relations: RelationData[] } },
    ctx: IContext,
  ) {
    const eventName = TelemetryEvent.CONNECTION_SAVE_RELATION;
    try {
      const savedRelations = await ctx.modelService.saveRelations(
        arg.data.relations,
      );
      // async deploy
      this.deploy(ctx);
      ctx.telemetry.sendEvent(eventName, {
        relationCount: savedRelations.length,
      });
      return savedRelations;
    } catch (err: any) {
      ctx.telemetry.sendEvent(
        eventName,
        { error: err.message },
        err.extensions?.service,
        false,
      );
      throw err;
    }
  }

  public async getSchemaChange(_root: any, _arg: any, ctx: IContext) {
    const project = await ctx.projectService.getCurrentProject();
    const lastSchemaChange =
      await ctx.schemaChangeRepository.findLastSchemaChange(project.id);

    if (!lastSchemaChange) {
      return {
        deletedTables: null,
        deletedColumns: null,
        modifiedColumns: null,
        lastSchemaChangeTime: null,
      };
    }

    const models = await ctx.modelRepository.findAllBy({
      projectId: project.id,
    });
    const modelIds = models.map((model) => model.id);
    const modelColumns =
      await ctx.modelColumnRepository.findColumnsByModelIds(modelIds);

    const modelRelationships = await ctx.relationRepository.findRelationInfoBy({
      modelIds,
    });

    const schemaDetector = new DataSourceSchemaDetector({
      ctx,
      projectId: project.id,
    });

    const resolves = lastSchemaChange.resolve;
    const unresolvedChanges = Object.keys(resolves).reduce((result, key) => {
      const isResolved = resolves[key];
      const changes = lastSchemaChange.change[key];
      // return if resolved or no changes
      if (isResolved || !changes) return result;

      // Mapping with affected models and columns and affected calculated fields and relationships data into schema change
      const affecteds = schemaDetector.getAffectedResources(changes, {
        models,
        modelColumns,
        modelRelationships,
      });

      const affectedChanges = affecteds.length ? affecteds : null;
      return { ...result, [key]: affectedChanges };
    }, {});

    return {
      ...unresolvedChanges,
      lastSchemaChangeTime: lastSchemaChange.createdAt,
    };
  }

  public async triggerDataSourceDetection(
    _root: any,
    _arg: any,
    ctx: IContext,
  ) {
    const project = await ctx.projectService.getCurrentProject();
    const schemaDetector = new DataSourceSchemaDetector({
      ctx,
      projectId: project.id,
    });
    const eventName = TelemetryEvent.MODELING_DETECT_SCHEMA_CHANGE;
    try {
      const hasSchemaChange = await schemaDetector.detectSchemaChange();
      ctx.telemetry.sendEvent(eventName, { hasSchemaChange });
      return hasSchemaChange;
    } catch (error: any) {
      ctx.telemetry.sendEvent(
        eventName,
        { error },
        error.extensions?.service,
        false,
      );
      throw error;
    }
  }

  public async resolveSchemaChange(
    _root: any,
    arg: { where: { type: SchemaChangeType } },
    ctx: IContext,
  ) {
    const { type } = arg.where;
    const project = await ctx.projectService.getCurrentProject();
    const schemaDetector = new DataSourceSchemaDetector({
      ctx,
      projectId: project.id,
    });
    const eventName = TelemetryEvent.MODELING_RESOLVE_SCHEMA_CHANGE;
    try {
      await schemaDetector.resolveSchemaChange(type);
      ctx.telemetry.sendEvent(eventName, { type });
    } catch (error) {
      ctx.telemetry.sendEvent(
        eventName,
        { type, error },
        error.extensions?.service,
        false,
      );
      throw error;
    }
    return true;
  }

  private async deploy(ctx: IContext) {
    const { id } = await ctx.projectService.getCurrentProject();
    const { manifest } = await ctx.mdlService.makeCurrentModelMDL();
    return await ctx.deployService.deploy(manifest, id);
  }

  private buildRelationInput(
    relations: SampleDatasetRelationship[],
    models: Model[],
    columns: ModelColumn[],
  ) {
    const relationInput = relations.map((relation) => {
      const { fromModelName, fromColumnName, toModelName, toColumnName, type } =
        relation;
      const fromModelId = models.find(
        (model) => model.sourceTableName === fromModelName,
      )?.id;
      const toModelId = models.find(
        (model) => model.sourceTableName === toModelName,
      )?.id;
      if (!fromModelId || !toModelId) {
        throw new Error(
          `Model not found, fromModelName "${fromModelName}" to toModelName: "${toModelName}"`,
        );
      }

      const fromColumnId = columns.find(
        (column) =>
          column.referenceName === fromColumnName &&
          column.modelId === fromModelId,
      )?.id;
      const toColumnId = columns.find(
        (column) =>
          column.referenceName === toColumnName && column.modelId === toModelId,
      )?.id;
      if (!fromColumnId || !toColumnId) {
        throw new Error(
          `Column not found fromColumnName: ${fromColumnName} toColumnName: ${toColumnName}`,
        );
      }
      return {
        fromModelId,
        fromColumnId,
        toModelId,
        toColumnId,
        type,
      } as RelationData;
    });
    return relationInput;
  }

  private async overwriteModelsAndColumns(
    tables: string[],
    ctx: IContext,
    project: Project,
  ) {
    // delete existing models and columns
    await ctx.modelService.deleteAllModelsByProjectId(project.id);

    // create model and columns
    const compactTables: CompactTable[] =
      await ctx.projectService.getProjectDataSourceTables(project);

    const modelValues = tables.map((tableName) => {
      const compactTable = compactTables.find(
        (table) => table.name === tableName,
      );
      if (!compactTable) {
        throw new Error(`Table not found in data source: ${tableName}`);
      }
      const properties = compactTable?.properties;
      // compactTable contain schema and catalog, these information are for building tableReference in mdl
      const model = {
        projectId: project.id,
        displayName: tableName, //use table name as displayName, referenceName and tableName
        referenceName: replaceInvalidReferenceName(tableName),
        sourceTableName: tableName,
        cached: false,
        refreshTime: null,
        properties: properties ? JSON.stringify(properties) : null,
      } as Partial<Model>;
      return model;
    });
    const models = await ctx.modelRepository.createMany(modelValues);

    const columnValues = [];
    tables.forEach((tableName) => {
      const compactTable = compactTables.find(
        (table) => table.name === tableName,
      );
      const compactColumns = compactTable.columns;
      const primaryKey = compactTable.primaryKey;
      const model = models.find((m) => m.sourceTableName === compactTable.name);
      compactColumns.forEach((column) => {
        const columnValue = {
          modelId: model.id,
          isCalculated: false,
          displayName: column.name,
          referenceName: this.transformInvalidColumnName(column.name),
          sourceColumnName: column.name,
          type: column.type || 'string',
          notNull: column.notNull || false,
          isPk: primaryKey === column.name,
          properties: column.properties
            ? JSON.stringify(column.properties)
            : null,
        } as Partial<ModelColumn>;
        columnValues.push(columnValue);
      });
    });
    const columns = await ctx.modelColumnRepository.createMany(columnValues);

    return { models, columns };
  }

  private transformInvalidColumnName(columnName: string) {
    let referenceName = replaceAllowableSyntax(columnName);
    // If the reference name does not start with a letter, add a prefix
    const startWithLetterRegex = /^[A-Za-z]/;
    if (!startWithLetterRegex.test(referenceName)) {
      referenceName = `col_${referenceName}`;
    }
    return referenceName;
  }

  private concatInitSql(initSql: string, extensions: string[]) {
    const installExtensions = extensions
      .map((ext) => `INSTALL ${ext};`)
      .join('\n');
    return trim(`${installExtensions}\n${initSql}`);
  }

  private async buildDuckDbEnvironment(
    ctx: IContext,
    options: {
      initSql: string;
      extensions: string[];
      configurations: Record<string, any>;
    },
  ): Promise<void> {
    const { initSql, extensions, configurations } = options;
    const initSqlWithExtensions = this.concatInitSql(initSql, extensions);
    await ctx.wrenEngineAdaptor.prepareDuckDB({
      sessionProps: configurations,
      initSql: initSqlWithExtensions,
    } as DuckDBPrepareOptions);

    // check can list dataset table
    await ctx.wrenEngineAdaptor.listTables();

    // patch wren-engine config
    const config = {
      'wren.datasource.type': 'duckdb',
    };
    await ctx.wrenEngineAdaptor.patchConfig(config);
  }
}
