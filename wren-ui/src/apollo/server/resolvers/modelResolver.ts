import { BigQueryOptions } from '@google-cloud/bigquery';
import { CreateModelData } from '../models';
import { Model, ModelColumn, Project } from '../repositories';
import { IContext } from '../types';
import { getLogger } from '@server/utils';
import { CompactTable } from '../connectors/connector';
import { BQConnector } from '../connectors/bqConnector';
import { GenerateReferenceNameData } from '../services/modelService';
import { DeployResponse } from '../services/deployService';

const logger = getLogger('ModelResolver');
logger.level = 'debug';

export class ModelResolver {
  constructor() {
    this.listModels = this.listModels.bind(this);
    this.getModel = this.getModel.bind(this);
    this.createModel = this.createModel.bind(this);
    this.deleteModel = this.deleteModel.bind(this);
    this.deploy = this.deploy.bind(this);
    this.checkModelSync = this.checkModelSync.bind(this);
  }

  public async checkModelSync(_root: any, _args: any, ctx: IContext) {
    const project = await ctx.projectService.getCurrentProject();
    const manifest = await ctx.mdlService.makeCurrentModelMDL();
    const currentHash = ctx.deployService.createMDLHash(manifest);
    const lastDeployHash = await ctx.deployService.getLastDeployment(
      project.id,
    );

    return currentHash == lastDeployHash
      ? { isSyncronized: true }
      : { isSyncronized: false };
  }

  public async deploy(
    _root: any,
    _args: any,
    ctx: IContext,
  ): Promise<DeployResponse> {
    const project = await ctx.projectService.getCurrentProject();
    const manifest = await ctx.mdlService.makeCurrentModelMDL();
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
    const {
      displayName,
      sourceTableName,
      refSql,
      cached,
      refreshTime,
      fields,
      description,
    } = args.data;

    const project = await ctx.projectService.getCurrentProject();
    const filePath = await ctx.projectService.getCredentialFilePath(project);
    const connector = await this.getBQConnector(project, filePath);
    const dataSourceTables = <CompactTable[]>await connector.listTables({
      datasetId: project.datasetId,
      format: true,
    });
    this.validateTableExist(sourceTableName, dataSourceTables);
    this.validateColumnsExist(sourceTableName, fields, dataSourceTables);

    const generateOption = {
      displayName,
      sourceTableName,
      existedReferenceNames: [],
    } as GenerateReferenceNameData;
    const referenceName =
      ctx.modelService.generateReferenceName(generateOption);
    const modelValue = {
      projectId: project.id,
      displayName, //use table name as model name
      referenceName,
      sourceTableName,
      refSql: refSql || `SELECT * FROM ${sourceTableName}`,
      cached,
      refreshTime,
      properties: JSON.stringify({ description }),
    } as Partial<Model>;
    const model = await ctx.modelRepository.createOne(modelValue);
    const modelId = model.id;

    // general fields
    const dataSourceColumns = dataSourceTables.find(
      (c) => c.name === sourceTableName,
    ).columns;
    const columnValues = fields.map((fieldName) => {
      const dataSourceColumn = dataSourceColumns.find(
        (c) => c.name === fieldName,
      );
      return {
        modelId,
        displayName: fieldName,
        sourceColumnName: fieldName,
        referenceName: fieldName,
        isCalculated: false,
        isPk: false,
        notNull: dataSourceColumn.notNull,
        type: dataSourceColumn.type,
        properties: JSON.stringify({
          description: dataSourceColumn.description,
        }),
      };
    }) as ModelColumn[];

    // calculated fields
    const calculatedFieldsValue = args.data.calculatedFields.map((field) => ({
      modelId,
      displayName: field.name,
      sourceColumnName: field.name,
      referenceName: field.name,
      isCalculated: true,
      isPk: false,
      notNull: false,
      aggregation: field.expression,
      lineage: JSON.stringify(field.lineage),
      diagram: JSON.stringify(field.diagram),
      properties: JSON.stringify({ description: '' }),
    })) as ModelColumn[];
    await ctx.modelColumnRepository.createMany(
      columnValues.concat(calculatedFieldsValue),
    );
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

  private async getBQConnector(project: Project, filePath: string) {
    // fetch tables
    const { projectId } = project;
    const connectionOption: BigQueryOptions = {
      projectId,
      keyFilename: filePath,
    };
    return new BQConnector(connectionOption);
  }

  private validateTableExist(tableName: string, columns: CompactTable[]) {
    if (!columns.find((c) => c.name === tableName)) {
      throw new Error(`Table ${tableName} not found`);
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
        throw new Error(`Column ${field} not found in table ${tableName}`);
      }
    }
  }
}
