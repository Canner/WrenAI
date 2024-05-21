import {
  CreateModelData,
  UpdateModelData,
  UpdateModelMetadataInput,
  CreateCalculatedFieldData,
  UpdateCalculatedFieldData,
  UpdateViewMetadataInput,
} from '../models';
import { IContext, RelationData, UpdateRelationData } from '../types';
import { getLogger } from '@server/utils';
import { CompactTable } from '../connectors/connector';
import { DeployResponse } from '../services/deployService';
import { constructCteSql } from '../services/askingService';
import { format } from 'sql-formatter';
import { isEmpty, isNil } from 'lodash';
import { DataSourceStrategyFactory } from '../factories/onboardingFactory';
import { replaceAllowableSyntax, validateDisplayName } from '../utils/regex';
import * as Errors from '@server/utils/error';

const logger = getLogger('ModelResolver');
logger.level = 'debug';

export enum SyncStatusEnum {
  IN_PROGRESS = 'IN_PROGRESS',
  SYNCRONIZED = 'SYNCRONIZED',
  UNSYNCRONIZED = 'UNSYNCRONIZED',
}

const PREVIEW_MAX_OUTPUT_ROW = 100;

export class ModelResolver {
  constructor() {
    // model & model column
    this.listModels = this.listModels.bind(this);
    this.getModel = this.getModel.bind(this);
    this.createModel = this.createModel.bind(this);
    this.updateModel = this.updateModel.bind(this);
    this.deleteModel = this.deleteModel.bind(this);
    this.updateModelMetadata = this.updateModelMetadata.bind(this);
    this.deploy = this.deploy.bind(this);
    this.checkModelSync = this.checkModelSync.bind(this);

    // view
    this.listViews = this.listViews.bind(this);
    this.getView = this.getView.bind(this);
    this.validateView = this.validateView.bind(this);
    this.createView = this.createView.bind(this);
    this.deleteView = this.deleteView.bind(this);
    this.updateViewMetadata = this.updateViewMetadata.bind(this);

    // preview
    this.previewModelData = this.previewModelData.bind(this);
    this.previewViewData = this.previewViewData.bind(this);
    this.getNativeSql = this.getNativeSql.bind(this);

    // calculated field
    this.createCalculatedField = this.createCalculatedField.bind(this);
    this.validateCalculatedField = this.validateCalculatedField.bind(this);
    this.updateCalculatedField = this.updateCalculatedField.bind(this);
    this.deleteCalculatedField = this.deleteCalculatedField.bind(this);

    // relation
    this.createRelation = this.createRelation.bind(this);
    this.updateRelation = this.updateRelation.bind(this);
    this.deleteRelation = this.deleteRelation.bind(this);
  }

  public async createRelation(
    _root: any,
    args: { data: RelationData },
    ctx: IContext,
  ) {
    const { data } = args;
    const relation = await ctx.modelService.createRelation(data);
    return relation;
  }

  public async updateRelation(
    _root: any,
    args: { data: UpdateRelationData; where: { id: number } },
    ctx: IContext,
  ) {
    const { data, where } = args;
    const relation = await ctx.modelService.updateRelation(data, where.id);
    return relation;
  }

  public async deleteRelation(
    _root: any,
    args: { where: { id: number } },
    ctx: IContext,
  ) {
    const relationId = args.where.id;
    await ctx.modelService.deleteRelation(relationId);
    return true;
  }

  public async createCalculatedField(
    _root: any,
    _args: { data: CreateCalculatedFieldData },
    ctx: IContext,
  ) {
    const column = await ctx.modelService.createCalculatedField(_args.data);
    return column;
  }

  public async validateCalculatedField(_root: any, args: any, ctx: IContext) {
    const { name, modelId, columnId } = args.data;
    return await ctx.modelService.validateCalculatedFieldNaming(
      name,
      modelId,
      columnId,
    );
  }

  public async updateCalculatedField(
    _root: any,
    _args: { data: UpdateCalculatedFieldData; where: { id: number } },
    ctx: IContext,
  ) {
    const { data, where } = _args;
    const column = await ctx.modelService.updateCalculatedField(data, where.id);
    return column;
  }

  public async deleteCalculatedField(_root: any, args: any, ctx: IContext) {
    const columnId = args.where.id;
    // check column exist and is calculated field
    const column = await ctx.modelColumnRepository.findOneBy({ id: columnId });
    if (!column || !column.isCalculated) {
      throw new Error('Calculated field not found');
    }
    await ctx.modelColumnRepository.deleteOne(columnId);
    return true;
  }

  public async checkModelSync(_root: any, _args: any, ctx: IContext) {
    const project = await ctx.projectService.getCurrentProject();
    const { manifest } = await ctx.mdlService.makeCurrentModelMDL();
    const currentHash = ctx.deployService.createMDLHash(manifest);
    const lastDeployHash = await ctx.deployService.getLastDeployment(
      project.id,
    );
    const inProgressDeployment =
      await ctx.deployService.getInProgressDeployment(project.id);
    if (inProgressDeployment) {
      return { status: SyncStatusEnum.IN_PROGRESS };
    }
    return currentHash == lastDeployHash
      ? { status: SyncStatusEnum.SYNCRONIZED }
      : { status: SyncStatusEnum.UNSYNCRONIZED };
  }

  public async deploy(
    _root: any,
    _args: any,
    ctx: IContext,
  ): Promise<DeployResponse> {
    const project = await ctx.projectService.getCurrentProject();
    const { manifest } = await ctx.mdlService.makeCurrentModelMDL();
    return await ctx.deployService.deploy(manifest, project.id);
  }

  public async listModels(_root: any, _args: any, ctx: IContext) {
    const project = await ctx.projectService.getCurrentProject();
    const projectId = project.id;
    const models = await ctx.modelRepository.findAllBy({ projectId });
    const modelIds = models.map((m) => m.id);
    const modelColumnList =
      await ctx.modelColumnRepository.findColumnsByModelIds(modelIds);
    const result = [];
    for (const model of models) {
      const modelFields = modelColumnList
        .filter((c) => c.modelId === model.id)
        .map((c) => {
          c.properties = JSON.parse(c.properties);
          return c;
        });
      const fields = modelFields.filter((c) => !c.isCalculated);
      const calculatedFields = modelFields.filter((c) => c.isCalculated);
      result.push({
        ...model,
        fields,
        calculatedFields,
        properties: {
          ...JSON.parse(model.properties),
        },
      });
    }
    return result;
  }

  public async getModel(_root: any, args: any, ctx: IContext) {
    const modelId = args.where.id;
    const model = await ctx.modelRepository.findOneBy({ id: modelId });
    if (!model) {
      throw new Error('Model not found');
    }
    let modelColumns = await ctx.modelColumnRepository.findColumnsByModelIds([
      model.id,
    ]);
    modelColumns = modelColumns.map((c) => {
      c.properties = JSON.parse(c.properties);
      return c;
    });
    let relations = await ctx.relationRepository.findRelationsBy({
      columnIds: modelColumns.map((c) => c.id),
    });
    relations = relations.map((r) => ({
      ...r,
      type: r.joinType,
      properties: r.properties ? JSON.parse(r.properties) : {},
    }));

    return {
      ...model,
      fields: modelColumns.filter((c) => !c.isCalculated),
      calculatedFields: modelColumns.filter((c) => c.isCalculated),
      relations,
      properties: {
        ...JSON.parse(model.properties),
      },
    };
  }

  public async createModel(
    _root: any,
    args: { data: CreateModelData },
    ctx: IContext,
  ) {
    const { sourceTableName, fields, primaryKey } = args.data;

    const project = await ctx.projectService.getCurrentProject();
    const dataSourceType = project.type;
    const strategyOptions = {
      ctx,
      project,
    };
    const strategy = DataSourceStrategyFactory.create(
      dataSourceType,
      strategyOptions,
    );
    const dataSourceTables = await strategy.listTable({
      formatToCompactTable: true,
    });
    this.validateTableExist(sourceTableName, dataSourceTables);
    this.validateColumnsExist(sourceTableName, fields, dataSourceTables);

    const { model, _columns } = await strategy.saveModel(
      sourceTableName,
      fields,
      primaryKey,
    );
    logger.info(`Model created: ${JSON.stringify(model)}`);

    return model;
  }

  public async updateModel(
    _root: any,
    args: { data: UpdateModelData; where: { id: number } },
    ctx: IContext,
  ) {
    const { fields, primaryKey } = args.data;

    const project = await ctx.projectService.getCurrentProject();
    const dataSourceType = project.type;
    const strategyOptions = {
      ctx,
      project,
    };
    const strategy = DataSourceStrategyFactory.create(
      dataSourceType,
      strategyOptions,
    );
    const dataSourceTables = await strategy.listTable({
      formatToCompactTable: true,
    });
    const model = await ctx.modelRepository.findOneBy({ id: args.where.id });
    const { sourceTableName } = model;
    this.validateTableExist(sourceTableName, dataSourceTables);
    this.validateColumnsExist(sourceTableName, fields, dataSourceTables);

    await strategy.updateModel(model, fields, primaryKey);
    logger.info(`Model created: ${JSON.stringify(model)}`);

    return model;
  }

  // delete model
  public async deleteModel(_root: any, args: any, ctx: IContext) {
    const modelId = args.where.id;
    const model = await ctx.modelRepository.findOneBy({ id: modelId });
    if (!model) {
      throw new Error('Model not found');
    }
    const modelColumns = await ctx.modelColumnRepository.findColumnsByModelIds([
      model.id,
    ]);
    logger.debug('find columns');
    const columnIds = modelColumns.map((c) => c.id);
    await ctx.relationRepository.deleteRelationsByColumnIds(columnIds);
    await ctx.modelColumnRepository.deleteMany(columnIds);
    await ctx.modelRepository.deleteOne(modelId);
    return true;
  }

  // update model metadata
  public async updateModelMetadata(
    _root: any,
    args: { where: { id: number }; data: UpdateModelMetadataInput },
    ctx: IContext,
  ): Promise<boolean> {
    const modelId = args.where.id;
    const data = args.data;

    // check if model exists
    const model = await ctx.modelRepository.findOneBy({ id: modelId });
    if (!model) {
      throw new Error('Model not found');
    }

    // update model metadata
    const modelMetadata: any = {};

    // if displayName is not null, or undefined, update the displayName
    if (!isNil(data.displayName)) {
      modelMetadata.displayName = this.determineMetadataValue(data.displayName);
    }

    // if description is not null, or undefined, update the description in properties
    if (!isNil(data.description)) {
      const properties = isNil(model.properties)
        ? {}
        : JSON.parse(model.properties);

      properties.description = this.determineMetadataValue(data.description);
      modelMetadata.properties = JSON.stringify(properties);
    }

    if (!isEmpty(modelMetadata)) {
      await ctx.modelRepository.updateOne(modelId, modelMetadata);
    }

    // todo: considering using update ... from statement to do a batch update
    // update column metadata
    if (!isEmpty(data.columns)) {
      // find the columns that match the user requested columns
      const columnIds = data.columns.map((c) => c.id);
      const modelColumns =
        await ctx.modelColumnRepository.findColumnsByIds(columnIds);
      for (const col of modelColumns) {
        const requestedMetadata = data.columns.find((c) => c.id === col.id);

        // update metadata
        const columnMetadata: any = {};

        if (!isNil(requestedMetadata.displayName)) {
          columnMetadata.displayName = this.determineMetadataValue(
            requestedMetadata.displayName,
          );
        }

        if (!isNil(requestedMetadata.description)) {
          const properties = col.properties ? JSON.parse(col.properties) : {};
          properties.description = this.determineMetadataValue(
            requestedMetadata.description,
          );
          columnMetadata.properties = JSON.stringify(properties);
        }

        if (!isEmpty(columnMetadata)) {
          await ctx.modelColumnRepository.updateOne(col.id, columnMetadata);
        }
      }
    }

    // update calculated field metadata
    if (!isEmpty(data.calculatedFields)) {
      const calculatedFieldIds = data.calculatedFields.map((c) => c.id);
      const modelColumns =
        await ctx.modelColumnRepository.findColumnsByIds(calculatedFieldIds);
      for (const col of modelColumns) {
        const requestedMetadata = data.calculatedFields.find(
          (c) => c.id === col.id,
        );

        const columnMetadata: any = {};
        // check if description is empty
        // if description is empty, skip the update
        // if description is not empty, update the description in properties
        if (!isNil(requestedMetadata.description)) {
          const properties = col.properties ? JSON.parse(col.properties) : {};
          properties.description = this.determineMetadataValue(
            requestedMetadata.description,
          );
          columnMetadata.properties = JSON.stringify(properties);
        }

        if (!isEmpty(columnMetadata)) {
          await ctx.modelColumnRepository.updateOne(col.id, columnMetadata);
        }
      }
    }

    // update relationship metadata
    if (!isEmpty(data.relationships)) {
      const relationshipIds = data.relationships.map((r) => r.id);
      const relationships =
        await ctx.relationRepository.findRelationsByIds(relationshipIds);
      for (const rel of relationships) {
        const requestedMetadata = data.relationships.find(
          (r) => r.id === rel.id,
        );

        const relationMetadata: any = {};

        if (!isNil(requestedMetadata.description)) {
          const properties = rel.properties ? JSON.parse(rel.properties) : {};
          properties.description = this.determineMetadataValue(
            requestedMetadata.description,
          );
          relationMetadata.properties = JSON.stringify(properties);
        }

        if (!isEmpty(relationMetadata)) {
          await ctx.relationRepository.updateOne(rel.id, relationMetadata);
        }
      }
    }

    return true;
  }

  // list views
  public async listViews(_root: any, _args: any, ctx: IContext) {
    const project = await ctx.projectService.getCurrentProject();
    const views = await ctx.viewRepository.findAllBy({ projectId: project.id });
    return views;
  }

  public async getView(_root: any, args: any, ctx: IContext) {
    const viewId = args.where.id;
    const view = await ctx.viewRepository.findOneBy({ id: viewId });
    if (!view) {
      throw new Error('View not found');
    }
    return view;
  }

  // validate a view name
  public async validateView(_root: any, args: any, ctx: IContext) {
    const { name } = args.data;
    return this.validateViewName(name, ctx);
  }

  // create view from sql of a response
  public async createView(_root: any, args: any, ctx: IContext) {
    const { name: displayName, responseId } = args.data;

    // validate view name
    const validateResult = await this.validateViewName(displayName, ctx);
    if (!validateResult.valid) {
      throw new Error(validateResult.message);
    }

    // create view
    const project = await ctx.projectService.getCurrentProject();

    // get sql statement of a response
    const response = await ctx.askingService.getResponse(responseId);
    if (!response) {
      throw new Error(`Thread response ${responseId} not found`);
    }

    // construct cte sql and format it
    const steps = response.detail.steps;
    const statement = format(constructCteSql(steps));

    // describe columns
    const { columns } =
      await ctx.wrenEngineAdaptor.describeStatement(statement);
    if (isEmpty(columns)) {
      throw new Error('Failed to describe statement');
    }

    // if the response contains error, throw error
    // this is to prevent creating view from a response with error
    if (response.error) {
      throw Errors.create(Errors.GeneralErrorCodes.INVALID_VIEW_CREATION, {
        customMessage: 'Cannot create view from a thread response with error',
      });
    }

    // properties
    const properties = {
      displayName,
      columns,
    };

    // create view
    const name = replaceAllowableSyntax(displayName);
    const view = await ctx.viewRepository.createOne({
      projectId: project.id,
      name,
      statement,
      properties: JSON.stringify(properties),
    });

    // telemetry
    ctx.telemetry.send_event('create_view', {
      statement,
      displayName,
    });

    return view;
  }

  // delete view
  public async deleteView(_root: any, args: any, ctx: IContext) {
    const viewId = args.where.id;
    const view = await ctx.viewRepository.findOneBy({ id: viewId });
    if (!view) {
      throw new Error('View not found');
    }
    await ctx.viewRepository.deleteOne(viewId);
    return true;
  }

  public async previewModelData(_root: any, args: any, ctx: IContext) {
    const modelId = args.where.id;
    const model = await ctx.modelRepository.findOneBy({ id: modelId });
    if (!model) {
      throw new Error('Model not found');
    }

    // pass the current mdl to wren engine to preview data, prevent the model is not deployed
    const { manifest } = await ctx.mdlService.makeCurrentModelMDL();
    const sql = `select * from ${model.referenceName}`;
    const data = await ctx.wrenEngineAdaptor.previewData(
      sql,
      PREVIEW_MAX_OUTPUT_ROW,
      manifest,
    );
    return data;
  }

  public async previewViewData(_root: any, args: any, ctx: IContext) {
    const viewId = args.where.id;
    const view = await ctx.viewRepository.findOneBy({ id: viewId });
    if (!view) {
      throw new Error('View not found');
    }

    const data = await ctx.wrenEngineAdaptor.previewData(
      view.statement,
      PREVIEW_MAX_OUTPUT_ROW,
    );
    return data;
  }

  public async getNativeSql(
    _root: any,
    args: { responseId: number },
    ctx: IContext,
  ): Promise<string> {
    const { responseId } = args;

    // If using a sample dataset, native SQL is not supported
    const project = await ctx.projectService.getCurrentProject();
    const sampleDataset = project.sampleDataset;
    if (sampleDataset) {
      throw new Error(`Doesn't support Native SQL`);
    }

    // get sql statement of a response
    const response = await ctx.askingService.getResponse(responseId);
    if (!response) {
      throw new Error(`Thread response ${responseId} not found`);
    }

    // construct cte sql and format it
    const steps = response.detail.steps;
    const sql = format(constructCteSql(steps));

    return await ctx.wrenEngineAdaptor.getNativeSQL(sql);
  }

  public async updateViewMetadata(
    _root: any,
    args: { where: { id: number }; data: UpdateViewMetadataInput },
    ctx: IContext,
  ): Promise<boolean> {
    const viewId = args.where.id;
    const data = args.data;

    // check if view exists
    const view = await ctx.viewRepository.findOneBy({ id: viewId });
    if (!view) {
      throw new Error('View not found');
    }

    // update view metadata
    const properties = JSON.parse(view.properties);
    let newName = view.name;
    // if displayName is not null, or undefined, update the displayName
    if (!isNil(data.displayName)) {
      await this.validateViewName(data.displayName, ctx, viewId);
      newName = replaceAllowableSyntax(data.displayName);
      properties.displayName = this.determineMetadataValue(data.displayName);
    }

    // if description is not null, or undefined, update the description in properties
    if (!isNil(data.description)) {
      properties.description = this.determineMetadataValue(data.description);
    }

    // view column metadata
    if (!isEmpty(data.columns)) {
      const viewColumns = properties.columns;
      for (const col of viewColumns) {
        const requestedMetadata = data.columns.find(
          (c) => c.referenceName === col.name,
        );

        if (!isNil(requestedMetadata.description)) {
          col.properties = col.properties || {};
          col.properties.description = this.determineMetadataValue(
            requestedMetadata.description,
          );
        }
      }

      properties.columns = viewColumns;
    }

    await ctx.viewRepository.updateOne(viewId, {
      name: newName,
      properties: JSON.stringify(properties),
    });

    return true;
  }

  private determineMetadataValue(value: string) {
    // if it's empty string, meaning users want to remove the value
    // so we return null
    if (value === '') {
      return null;
    }

    // otherwise, return the value
    return value;
  }

  // validate view name
  private async validateViewName(
    viewDisplayName: string,
    ctx: IContext,
    selfView?: number,
  ): Promise<{ valid: boolean; message?: string }> {
    // check if view name is valid
    // a-z, A-Z, 0-9, _, - are allowed and cannot start with number
    const { valid, message } = validateDisplayName(viewDisplayName);
    if (!valid) {
      return {
        valid: false,
        message,
      };
    }
    const referenceName = replaceAllowableSyntax(viewDisplayName);
    // check if view name is duplicated
    const project = await ctx.projectService.getCurrentProject();
    const views = await ctx.viewRepository.findAllBy({ projectId: project.id });
    if (views.find((v) => v.name === referenceName && v.id !== selfView)) {
      return {
        valid: false,
        message: `Generated view name "${referenceName}" is duplicated`,
      };
    }

    return {
      valid: true,
    };
  }

  private validateTableExist(tableName: string, columns: CompactTable[]) {
    if (!columns.find((c) => c.name === tableName)) {
      throw new Error(`Table ${tableName} not found in the data Source`);
    }
  }

  private validateColumnsExist(
    tableName: string,
    fields: string[],
    columns: CompactTable[],
  ) {
    const tableColumns = columns.find((c) => c.name === tableName)?.columns;
    for (const field of fields) {
      if (!tableColumns.find((c) => c.name === field)) {
        throw new Error(
          `Column "${field}" not found in table "${tableName}" in the data Source`,
        );
      }
    }
  }
}
