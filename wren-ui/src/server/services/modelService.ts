import { SampleDatasetTable } from '@server/data';
import {
  IModelColumnRepository,
  IModelRepository,
  IRelationRepository,
  IViewRepository,
  Model,
  ModelColumn,
  Relation,
  View,
} from '@server/repositories';
import {
  getLogger,
  safeParseJson,
  replaceAllowableSyntax,
  validateDisplayName,
} from '@server/utils';
import { RelationData, UpdateRelationData } from '@server/types';
import {
  CreateCalculatedFieldData,
  ExpressionName,
  UpdateCalculatedFieldData,
  CheckCalculatedFieldCanQueryData,
} from '@server/models';
import { IMDLService } from './mdlService';
import { IWrenEngineAdaptor } from '../adaptors/wrenEngineAdaptor';
import { ValidationRules } from '@server/adaptors/ibisAdaptor';
import { isEmpty, capitalize } from 'lodash';
import {} from '@server/utils/regex';
import * as Errors from '@server/utils/error';
import { DataSourceName } from '@server/types';
import { IQueryService } from './queryService';
import { PersistedRuntimeIdentity } from '@server/context/runtimeScope';
import {
  hasCanonicalRuntimeIdentity,
  resolvePersistedProjectBridgeId,
  toProjectBridgeRuntimeIdentity,
  toPersistedRuntimeIdentityPatch,
} from '@server/utils/persistedRuntimeIdentity';

const logger = getLogger('ModelService');
logger.level = 'debug';

export interface ValidateCalculatedFieldResponse {
  valid: boolean;
  message?: string;
}

export interface IModelService {
  listModelsByRuntimeIdentity(
    runtimeIdentity: PersistedRuntimeIdentity,
  ): Promise<Model[]>;
  getModelsByRuntimeIdentity(
    runtimeIdentity: PersistedRuntimeIdentity,
    modelIds: number[],
  ): Promise<Model[]>;
  getModelByRuntimeIdentity(
    runtimeIdentity: PersistedRuntimeIdentity,
    modelId: number,
  ): Promise<Model | null>;
  getModelsScoped(
    bridgeProjectId: number,
    modelIds: number[],
  ): Promise<Model[]>;
  getModelScoped(
    bridgeProjectId: number,
    modelId: number,
  ): Promise<Model | null>;
  getColumnScoped(
    bridgeProjectId: number,
    columnId: number,
  ): Promise<ModelColumn | null>;
  getColumnByRuntimeIdentity(
    runtimeIdentity: PersistedRuntimeIdentity,
    columnId: number,
  ): Promise<ModelColumn | null>;
  getViewsScoped(bridgeProjectId: number): Promise<View[]>;
  getViewScoped(bridgeProjectId: number, viewId: number): Promise<View | null>;
  getViewsByRuntimeIdentity(
    runtimeIdentity: PersistedRuntimeIdentity,
  ): Promise<View[]>;
  getViewByRuntimeIdentity(
    runtimeIdentity: PersistedRuntimeIdentity,
    viewId: number,
  ): Promise<View | null>;
  getRelationScoped(
    bridgeProjectId: number,
    relationId: number,
  ): Promise<Relation | null>;
  getRelationByRuntimeIdentity(
    runtimeIdentity: PersistedRuntimeIdentity,
    relationId: number,
  ): Promise<Relation | null>;
  validateViewNameScoped(
    bridgeProjectId: number,
    viewDisplayName: string,
    selfView?: number,
  ): Promise<ValidateCalculatedFieldResponse>;
  validateViewNameByRuntimeIdentity(
    runtimeIdentity: PersistedRuntimeIdentity,
    viewDisplayName: string,
    selfView?: number,
  ): Promise<ValidateCalculatedFieldResponse>;
  updatePrimaryKeys(
    bridgeProjectId: number,
    tables: SampleDatasetTable[],
  ): Promise<void>;
  batchUpdateModelProperties(
    bridgeProjectId: number,
    tables: SampleDatasetTable[],
  ): Promise<void>;
  batchUpdateColumnProperties(
    bridgeProjectId: number,
    tables: SampleDatasetTable[],
  ): Promise<void>;
  // saveRelations was used in the onboarding process, we assume there is not existing relation in the project
  saveRelations(relations: RelationData[]): Promise<Relation[]>;
  saveRelationsByRuntimeIdentity(
    runtimeIdentity: PersistedRuntimeIdentity,
    relations: RelationData[],
    options?: {
      preserveProjectBridge?: boolean;
    },
  ): Promise<Relation[]>;
  createRelation(relation: RelationData): Promise<Relation>;
  createRelationByRuntimeIdentity(
    runtimeIdentity: PersistedRuntimeIdentity,
    relation: RelationData,
  ): Promise<Relation>;
  updateRelation(
    bridgeProjectId: number,
    relation: UpdateRelationData,
    id: number,
  ): Promise<Relation>;
  updateRelationByRuntimeIdentity(
    runtimeIdentity: PersistedRuntimeIdentity,
    relation: UpdateRelationData,
    id: number,
  ): Promise<Relation>;
  deleteRelation(bridgeProjectId: number, id: number): Promise<void>;
  deleteRelationByRuntimeIdentity(
    runtimeIdentity: PersistedRuntimeIdentity,
    id: number,
  ): Promise<void>;
  createCalculatedFieldScoped(
    bridgeProjectId: number,
    data: CreateCalculatedFieldData,
  ): Promise<ModelColumn>;
  createCalculatedFieldByRuntimeIdentity(
    runtimeIdentity: PersistedRuntimeIdentity,
    data: CreateCalculatedFieldData,
  ): Promise<ModelColumn>;
  updateCalculatedFieldScoped(
    bridgeProjectId: number,
    data: UpdateCalculatedFieldData,
    id: number,
  ): Promise<ModelColumn>;
  updateCalculatedFieldByRuntimeIdentity(
    runtimeIdentity: PersistedRuntimeIdentity,
    data: UpdateCalculatedFieldData,
    id: number,
  ): Promise<ModelColumn>;
  generateReferenceName(data: any): string;
  validateCalculatedFieldNaming(
    name: string,
    modelId: number,
    columnId?: number,
  ): Promise<ValidateCalculatedFieldResponse>;
  deleteAllViewsByProjectId(bridgeProjectId: number): Promise<void>;
  deleteAllModelsByProjectId(bridgeProjectId: number): Promise<void>;
}

export interface GenerateReferenceNameData {
  displayName: string;
  sourceTableName: string;
  existedReferenceNames: string[];
}

export class ModelService implements IModelService {
  private modelRepository: IModelRepository;
  private modelColumnRepository: IModelColumnRepository;
  private relationRepository: IRelationRepository;
  private viewRepository: IViewRepository;
  private mdlService: IMDLService;
  private wrenEngineAdaptor: IWrenEngineAdaptor;
  private queryService: IQueryService;

  constructor({
    projectService: _projectService,
    modelRepository,
    modelColumnRepository,
    relationRepository,
    viewRepository,
    mdlService,
    wrenEngineAdaptor,
    queryService,
  }: {
    projectService: unknown;
    modelRepository: IModelRepository;
    modelColumnRepository: IModelColumnRepository;
    relationRepository: IRelationRepository;
    viewRepository: IViewRepository;
    mdlService: IMDLService;
    wrenEngineAdaptor: IWrenEngineAdaptor;
    queryService: IQueryService;
  }) {
    this.modelRepository = modelRepository;
    this.modelColumnRepository = modelColumnRepository;
    this.relationRepository = relationRepository;
    this.viewRepository = viewRepository;
    this.mdlService = mdlService;
    this.wrenEngineAdaptor = wrenEngineAdaptor;
    this.queryService = queryService;
  }

  private async createCalculatedField(
    data: CreateCalculatedFieldData,
  ): Promise<ModelColumn> {
    const { modelId, name: displayName, expression, lineage } = data;
    const logTitle = `Create Calculated Field ${displayName}`;
    const model = await this.modelRepository.findOneBy({
      id: modelId,
    });
    if (!model) {
      throw new Error('Model not found');
    }
    const { valid, message } = await this.validateCalculatedFieldNaming(
      displayName,
      modelId,
    );
    logger.debug(
      `${logTitle} : validateCalculatedFieldNaming: ${valid}, ${message}`,
    );
    if (!valid) {
      throw new Error(message);
    }

    // generate referenceName
    const referenceName =
      this.generateReferenceNameFromDisplayName(displayName);
    logger.debug(`${logTitle} : generated referenceName: "${referenceName}"`);

    // check this calculated field is valid for engine to query
    const { valid: canQuery, message: errorMessage } =
      await this.checkCalculatedFieldCanQuery(modelId, model.referenceName, {
        referenceName,
        expression,
        lineage,
      } as CheckCalculatedFieldCanQueryData);
    logger.debug(`${logTitle} : checkCalculatedFieldCanQuery: ${canQuery}`);
    if (!canQuery) {
      const parsedErrorMessage = safeParseJson(errorMessage);
      throw Errors.create(Errors.GeneralErrorCodes.INVALID_CALCULATED_FIELD, {
        customMessage: parsedErrorMessage?.message || errorMessage,
        originalError: parsedErrorMessage || null,
      });
    }
    const inputFieldId = lineage[lineage.length - 1];
    const dataType = await this.inferCalculatedFieldDataType(
      expression,
      inputFieldId,
    );
    logger.debug(`${logTitle} : inferCalculatedFieldDataType: ${dataType}`);

    // create calculated field
    const column = await this.modelColumnRepository.createOne({
      modelId,
      displayName: displayName,
      sourceColumnName: referenceName,
      referenceName,
      type: dataType,
      isCalculated: true,
      isPk: false,
      notNull: false,
      aggregation: expression,
      lineage: JSON.stringify(lineage),
      properties: JSON.stringify({ description: '' }),
    });
    return column;
  }

  public async createCalculatedFieldScoped(
    bridgeProjectId: number,
    data: CreateCalculatedFieldData,
  ): Promise<ModelColumn> {
    return this.createCalculatedFieldByRuntimeIdentity(
      toProjectBridgeRuntimeIdentity(bridgeProjectId),
      data,
    );
  }

  public async createCalculatedFieldByRuntimeIdentity(
    runtimeIdentity: PersistedRuntimeIdentity,
    data: CreateCalculatedFieldData,
  ): Promise<ModelColumn> {
    const model = await this.getModelByRuntimeIdentity(
      runtimeIdentity,
      data.modelId,
    );
    if (!model) {
      throw new Error('Model not found');
    }

    return this.createCalculatedField(data);
  }

  public async getModelsScoped(
    bridgeProjectId: number,
    modelIds: number[],
  ): Promise<Model[]> {
    const models = await this.getModelsByRuntimeIdentity(
      toProjectBridgeRuntimeIdentity(bridgeProjectId),
      modelIds,
    );
    if (models.some((model) => model.projectId !== bridgeProjectId)) {
      return [];
    }

    return models;
  }

  public async listModelsByRuntimeIdentity(
    runtimeIdentity: PersistedRuntimeIdentity,
  ): Promise<Model[]> {
    return this.modelRepository.findAllByRuntimeIdentity(runtimeIdentity);
  }

  public async getModelsByRuntimeIdentity(
    runtimeIdentity: PersistedRuntimeIdentity,
    modelIds: number[],
  ): Promise<Model[]> {
    const uniqueModelIds = [...new Set(modelIds)];
    const models = await this.modelRepository.findAllByIdsWithRuntimeIdentity(
      uniqueModelIds,
      runtimeIdentity,
    );
    const scopedModels = this.filterRecordsByRuntimeIdentityScope(
      models,
      runtimeIdentity,
    );
    if (scopedModels.length !== uniqueModelIds.length) {
      return [];
    }

    return scopedModels;
  }

  public async getModelByRuntimeIdentity(
    runtimeIdentity: PersistedRuntimeIdentity,
    modelId: number,
  ): Promise<Model | null> {
    const [model] = await this.getModelsByRuntimeIdentity(runtimeIdentity, [
      modelId,
    ]);
    return model || null;
  }

  public async getModelScoped(
    bridgeProjectId: number,
    modelId: number,
  ): Promise<Model | null> {
    const model = await this.getModelByRuntimeIdentity(
      toProjectBridgeRuntimeIdentity(bridgeProjectId),
      modelId,
    );
    if (!model || model.projectId !== bridgeProjectId) {
      return null;
    }

    return model;
  }

  public async getColumnScoped(
    bridgeProjectId: number,
    columnId: number,
  ): Promise<ModelColumn | null> {
    const column = await this.modelColumnRepository.findOneBy({ id: columnId });
    if (!column) {
      return null;
    }

    const model = await this.getModelScoped(bridgeProjectId, column.modelId);
    if (!model) {
      return null;
    }

    return column;
  }

  public async getColumnByRuntimeIdentity(
    runtimeIdentity: PersistedRuntimeIdentity,
    columnId: number,
  ): Promise<ModelColumn | null> {
    const column = await this.modelColumnRepository.findOneBy({ id: columnId });
    if (!column) {
      return null;
    }

    const model = await this.getModelByRuntimeIdentity(
      runtimeIdentity,
      column.modelId,
    );
    if (!model) {
      return null;
    }

    return column;
  }

  public async getViewsScoped(bridgeProjectId: number): Promise<View[]> {
    const views = await this.getViewsByRuntimeIdentity(
      toProjectBridgeRuntimeIdentity(bridgeProjectId),
    );
    return views.filter((view) => view.projectId === bridgeProjectId);
  }

  public async getViewsByRuntimeIdentity(
    runtimeIdentity: PersistedRuntimeIdentity,
  ): Promise<View[]> {
    const views =
      await this.viewRepository.findAllByRuntimeIdentity(runtimeIdentity);
    return this.filterRecordsByRuntimeIdentityScope(views, runtimeIdentity);
  }

  public async getViewScoped(
    bridgeProjectId: number,
    viewId: number,
  ): Promise<View | null> {
    const view = await this.getViewByRuntimeIdentity(
      toProjectBridgeRuntimeIdentity(bridgeProjectId),
      viewId,
    );
    if (!view || view.projectId !== bridgeProjectId) {
      return null;
    }

    return view;
  }

  public async getViewByRuntimeIdentity(
    runtimeIdentity: PersistedRuntimeIdentity,
    viewId: number,
  ): Promise<View | null> {
    const view = await this.viewRepository.findOneByIdWithRuntimeIdentity(
      viewId,
      runtimeIdentity,
    );
    if (view && !this.matchesRuntimeIdentityScope(view, runtimeIdentity)) {
      return null;
    }

    return view;
  }

  public async getRelationScoped(
    bridgeProjectId: number,
    relationId: number,
  ): Promise<Relation | null> {
    const relation = await this.getRelationByRuntimeIdentity(
      toProjectBridgeRuntimeIdentity(bridgeProjectId),
      relationId,
    );
    if (!relation || relation.projectId !== bridgeProjectId) {
      return null;
    }

    return relation;
  }

  public async getRelationByRuntimeIdentity(
    runtimeIdentity: PersistedRuntimeIdentity,
    relationId: number,
  ): Promise<Relation | null> {
    const relation =
      await this.relationRepository.findOneByIdWithRuntimeIdentity(
        relationId,
        runtimeIdentity,
      );
    if (
      relation &&
      !this.matchesRuntimeIdentityScope(relation, runtimeIdentity)
    ) {
      return null;
    }

    return relation;
  }

  public async validateViewNameScoped(
    bridgeProjectId: number,
    viewDisplayName: string,
    selfView?: number,
  ): Promise<ValidateCalculatedFieldResponse> {
    return this.validateViewNameByRuntimeIdentity(
      toProjectBridgeRuntimeIdentity(bridgeProjectId),
      viewDisplayName,
      selfView,
    );
  }

  public async validateViewNameByRuntimeIdentity(
    runtimeIdentity: PersistedRuntimeIdentity,
    viewDisplayName: string,
    selfView?: number,
  ): Promise<ValidateCalculatedFieldResponse> {
    const { valid, message } = validateDisplayName(viewDisplayName);
    if (!valid) {
      return {
        valid: false,
        message: message || undefined,
      };
    }

    const referenceName = replaceAllowableSyntax(viewDisplayName);
    const views = await this.getViewsByRuntimeIdentity(runtimeIdentity);
    return this.validateViewNameAgainstViews(views, referenceName, selfView);
  }

  private async updateCalculatedField(
    data: UpdateCalculatedFieldData,
    id: number,
  ): Promise<ModelColumn> {
    const { name: displayName, expression, lineage } = data;
    const logTitle = `Update Calculated Field ${id}`;
    const column = await this.modelColumnRepository.findOneBy({ id });
    if (!column) {
      throw new Error('Column not found');
    }
    const model = await this.modelRepository.findOneBy({
      id: column.modelId,
    });
    if (!model) {
      throw new Error('Model not found');
    }
    const { valid, message } = await this.validateCalculatedFieldNaming(
      displayName,
      column.modelId,
      id,
    );
    logger.debug(
      `${logTitle}: validateCalculatedFieldNaming: ${valid}, ${message}`,
    );
    if (!valid) {
      throw new Error(message);
    }
    const referenceName =
      this.generateReferenceNameFromDisplayName(displayName);
    logger.debug(`${logTitle}: generated referenceName: "${referenceName}"`);

    // check this calculated field is valid for engine to query
    const { valid: canQuery, message: errorMessage } =
      await this.checkCalculatedFieldCanQuery(model.id, model.referenceName, {
        referenceName,
        expression,
        lineage,
      } as CheckCalculatedFieldCanQueryData);
    logger.debug(`${logTitle}: checkCalculatedFieldCanQuery: ${canQuery}`);
    if (!canQuery) {
      const error = errorMessage ? JSON.parse(errorMessage) : null;
      throw Errors.create(Errors.GeneralErrorCodes.INVALID_CALCULATED_FIELD, {
        customMessage: error?.message,
        originalError: error,
      });
    }
    const inputFieldId = lineage[lineage.length - 1];
    const dataType = await this.inferCalculatedFieldDataType(
      expression,
      inputFieldId,
    );
    logger.debug(`${logTitle}: inferCalculatedFieldDataType: ${dataType}`);
    const updatedColumn = await this.modelColumnRepository.updateOne(id, {
      displayName: displayName,
      sourceColumnName: referenceName,
      referenceName,
      type: dataType,
      aggregation: expression,
      lineage: JSON.stringify(lineage),
    });
    return updatedColumn;
  }

  public async updateCalculatedFieldScoped(
    bridgeProjectId: number,
    data: UpdateCalculatedFieldData,
    id: number,
  ): Promise<ModelColumn> {
    return this.updateCalculatedFieldByRuntimeIdentity(
      toProjectBridgeRuntimeIdentity(bridgeProjectId),
      data,
      id,
    );
  }

  public async updateCalculatedFieldByRuntimeIdentity(
    runtimeIdentity: PersistedRuntimeIdentity,
    data: UpdateCalculatedFieldData,
    id: number,
  ): Promise<ModelColumn> {
    const column = await this.getColumnByRuntimeIdentity(runtimeIdentity, id);
    if (!column) {
      throw new Error('Column not found');
    }

    return this.updateCalculatedField(data, id);
  }

  public async updatePrimaryKeys(
    bridgeProjectId: number,
    tables: SampleDatasetTable[],
  ) {
    logger.debug('start update primary keys');
    const models = await this.modelRepository.findAllBy({
      projectId: bridgeProjectId,
    });
    const tableToUpdate = tables.filter((t) => t.primaryKey);
    for (const table of tableToUpdate) {
      if (!table.primaryKey) {
        continue;
      }
      const model = models.find((m) => m.sourceTableName === table.tableName);
      if (!model) {
        logger.debug(`Model not found, table name: ${table.tableName}`);
        continue;
      }
      await this.modelColumnRepository.setModelPrimaryKey(
        model.id,
        table.primaryKey,
      );
    }
  }

  public async batchUpdateModelProperties(
    bridgeProjectId: number,
    tables: SampleDatasetTable[],
  ) {
    logger.debug('start batch update model description');
    const models = await this.modelRepository.findAllBy({
      projectId: bridgeProjectId,
    });

    await Promise.all(
      tables.map(async (table) => {
        const model = models.find((m) => m.sourceTableName === table.tableName);
        if (!model) {
          logger.debug(`Model not found, table name: ${table.tableName}`);
          return;
        }
        const properties = model.properties
          ? { ...JSON.parse(model.properties), ...table.properties }
          : { ...table.properties };
        await this.modelRepository.updateOne(model.id, {
          displayName: table.properties?.displayName || model.displayName,
          properties: JSON.stringify(properties),
        });
      }),
    );
  }

  public async batchUpdateColumnProperties(
    bridgeProjectId: number,
    tables: SampleDatasetTable[],
  ) {
    logger.debug('start batch update column description');
    const models = await this.modelRepository.findAllBy({
      projectId: bridgeProjectId,
    });
    const sourceColumns =
      (await this.modelColumnRepository.findColumnsByModelIds(
        models.map((m) => m.id),
      )) as ModelColumn[];
    const transformedColumns = tables.reduce<
      Array<{
        tableName: string;
        name: string;
        description?: string;
        properties?: Record<string, any>;
      }>
    >((acc, table) => {
      const columns = table.columns?.map((column) => {
        return { ...column, tableName: table.tableName };
      });
      if (columns) {
        acc.push(...columns);
      }
      return acc;
    }, []);

    await Promise.all(
      transformedColumns.map(async (column) => {
        if (!column.properties) {
          return;
        }
        const model = models.find(
          (m) => m.sourceTableName === column.tableName,
        );
        if (!model) {
          logger.debug(`Model not found, table name: ${column.tableName}`);
          return;
        }
        const sourceColumn = sourceColumns.find(
          (sourceColumn) =>
            sourceColumn.modelId === model.id &&
            sourceColumn.sourceColumnName === column.name,
        );
        if (!sourceColumn) {
          logger.debug(
            `Column not found, table name: ${column.tableName}, column name: ${column.name}`,
          );
          return;
        }
        const properties = sourceColumn.properties
          ? {
              ...JSON.parse(sourceColumn.properties),
              ...column.properties,
            }
          : { description: column.description };
        await this.modelColumnRepository.updateOne(sourceColumn.id, {
          properties: JSON.stringify(properties),
        });
      }),
    );
  }

  public generateReferenceName(data: GenerateReferenceNameData): string {
    const { sourceTableName, existedReferenceNames } = data;
    if (!existedReferenceNames.includes(sourceTableName)) {
      return sourceTableName;
    }
    return `${sourceTableName}_${existedReferenceNames.length + 1}`;
  }

  public async saveRelations(relations: RelationData[]) {
    if (isEmpty(relations)) {
      return [];
    }
    const modelIds = relations
      .map(({ fromModelId, toModelId }) => [fromModelId, toModelId])
      .flat();
    const uniqueModelIds = [...new Set(modelIds)];
    const models = await this.modelRepository.findAllByIds(uniqueModelIds);
    const bridgeProjectId = this.requireSingleProjectBridgeForRelations(
      models,
      uniqueModelIds,
    );

    const columnIds = relations
      .map(({ fromColumnId, toColumnId }) => [fromColumnId, toColumnId])
      .flat();
    const uniqueColumnIds = [...new Set(columnIds)];
    const columns =
      await this.modelColumnRepository.findColumnsByIds(uniqueColumnIds);
    if (columns.length !== uniqueColumnIds.length) {
      throw new Error('Column not found');
    }
    const relationValues = relations.map((relation) => {
      const { valid, message } = this.validateCreateRelationSync(
        models,
        columns,
        relation,
      );
      if (!valid) {
        throw new Error(message);
      }
      const relationName = this.generateRelationName(relation, models, columns);
      return {
        projectId: bridgeProjectId,
        name: relationName,
        fromColumnId: relation.fromColumnId,
        toColumnId: relation.toColumnId,
        joinType: relation.type,
        properties: relation.description
          ? JSON.stringify({ description: relation.description })
          : null,
      } as Partial<Relation>;
    });

    const savedRelations =
      await this.relationRepository.createMany(relationValues);

    return savedRelations;
  }

  public async saveRelationsByRuntimeIdentity(
    runtimeIdentity: PersistedRuntimeIdentity,
    relations: RelationData[],
    options: {
      preserveProjectBridge?: boolean;
    } = {},
  ) {
    if (isEmpty(relations)) {
      return [];
    }

    const modelIds = relations
      .map(({ fromModelId, toModelId }) => [fromModelId, toModelId])
      .flat();
    const uniqueModelIds = [...new Set(modelIds)];
    const models = await this.getModelsByRuntimeIdentity(
      runtimeIdentity,
      uniqueModelIds,
    );
    if (models.length !== uniqueModelIds.length) {
      throw new Error('Model not found');
    }

    const columnIds = relations
      .map(({ fromColumnId, toColumnId }) => [fromColumnId, toColumnId])
      .flat();
    const uniqueColumnIds = [...new Set(columnIds)];
    const columns =
      await this.modelColumnRepository.findColumnsByIds(uniqueColumnIds);
    if (columns.length !== uniqueColumnIds.length) {
      throw new Error('Column not found');
    }

    const bridgeProjectId = options.preserveProjectBridge
      ? this.resolveRelationProjectBridgeForPersistence(models, runtimeIdentity)
      : this.resolveRuntimeRelationProjectBridgeFallback(runtimeIdentity, models);
    const runtimePatch = options.preserveProjectBridge
      ? {
          ...toPersistedRuntimeIdentityPatch({
            ...runtimeIdentity,
            projectId: null,
          }),
          projectId: bridgeProjectId,
        }
      : toPersistedRuntimeIdentityPatch({
          ...runtimeIdentity,
          projectId: bridgeProjectId,
        });

    const relationValues = relations.map((relation) => {
      const { valid, message } = this.validateCreateRelationSync(
        models,
        columns,
        relation,
      );
      if (!valid) {
        throw new Error(message);
      }
      const relationName = this.generateRelationName(relation, models, columns);
      return {
        ...runtimePatch,
        name: relationName,
        fromColumnId: relation.fromColumnId,
        toColumnId: relation.toColumnId,
        joinType: relation.type,
        properties: relation.description
          ? JSON.stringify({ description: relation.description })
          : null,
      } as Partial<Relation>;
    });

    return await this.relationRepository.createMany(relationValues);
  }

  public async createRelation(relation: RelationData): Promise<Relation> {
    const modelIds = [relation.fromModelId, relation.toModelId];
    const uniqueModelIds = [...new Set(modelIds)];
    const models = await this.modelRepository.findAllByIds(uniqueModelIds);
    const bridgeProjectId = this.requireSingleProjectBridgeForRelations(
      models,
      uniqueModelIds,
    );
    const columnIds = [relation.fromColumnId, relation.toColumnId];
    const uniqueColumnIds = [...new Set(columnIds)];
    const columns =
      await this.modelColumnRepository.findColumnsByIds(uniqueColumnIds);
    if (columns.length !== uniqueColumnIds.length) {
      throw new Error('Column not found');
    }

    const { valid, message } = await this.validateCreateRelation(
      models,
      columns,
      relation,
    );
    if (!valid) {
      throw new Error(message);
    }
    const relationName = this.generateRelationName(relation, models, columns);
    const savedRelation = await this.relationRepository.createOne({
      projectId: bridgeProjectId,
      name: relationName,
      fromColumnId: relation.fromColumnId,
      toColumnId: relation.toColumnId,
      joinType: relation.type,
    });
    return savedRelation;
  }

  public async createRelationByRuntimeIdentity(
    runtimeIdentity: PersistedRuntimeIdentity,
    relation: RelationData,
  ): Promise<Relation> {
    const modelIds = [relation.fromModelId, relation.toModelId];
    const models = await this.getModelsByRuntimeIdentity(
      runtimeIdentity,
      modelIds,
    );
    if (models.length !== [...new Set(modelIds)].length) {
      throw new Error('Model not found');
    }

    const columnIds = [relation.fromColumnId, relation.toColumnId];
    const columns =
      await this.modelColumnRepository.findColumnsByIds(columnIds);
    if (columns.length !== [...new Set(columnIds)].length) {
      throw new Error('Column not found');
    }

    const { valid, message } = this.validateCreateRelationSync(
      models,
      columns,
      relation,
    );
    if (!valid) {
      throw new Error(message);
    }

    const existedRelations =
      await this.relationRepository.findExistedRelationBetweenModels(
        relation,
        runtimeIdentity,
      );

    if (existedRelations.length > 0) {
      throw new Error('This relationship already exists.');
    }

    const relationName = this.generateRelationName(relation, models, columns);
    const bridgeProjectId = this.resolveRelationProjectBridgeForPersistence(
      models,
      runtimeIdentity,
    );
    return await this.relationRepository.createOne({
      ...toPersistedRuntimeIdentityPatch(runtimeIdentity),
      projectId: bridgeProjectId,
      name: relationName,
      fromColumnId: relation.fromColumnId,
      toColumnId: relation.toColumnId,
      joinType: relation.type,
      properties: relation.description
        ? JSON.stringify({ description: relation.description })
        : null,
    });
  }

  public async updateRelation(
    bridgeProjectId: number,
    relation: UpdateRelationData,
    id: number,
  ): Promise<Relation> {
    return this.updateRelationByRuntimeIdentity(
      toProjectBridgeRuntimeIdentity(bridgeProjectId),
      relation,
      id,
    );
  }

  public async updateRelationByRuntimeIdentity(
    runtimeIdentity: PersistedRuntimeIdentity,
    relation: UpdateRelationData,
    id: number,
  ): Promise<Relation> {
    const existing = await this.getRelationByRuntimeIdentity(
      runtimeIdentity,
      id,
    );
    if (!existing) {
      throw new Error('Relation not found');
    }

    return await this.relationRepository.updateOne(id, {
      joinType: relation.type,
    });
  }

  public async deleteRelation(
    bridgeProjectId: number,
    id: number,
  ): Promise<void> {
    await this.deleteRelationByRuntimeIdentity(
      toProjectBridgeRuntimeIdentity(bridgeProjectId),
      id,
    );
  }

  public async deleteRelationByRuntimeIdentity(
    runtimeIdentity: PersistedRuntimeIdentity,
    id: number,
  ): Promise<void> {
    const existing = await this.getRelationByRuntimeIdentity(
      runtimeIdentity,
      id,
    );
    if (!existing) {
      throw new Error('Relation not found');
    }

    const calculatedFields = await this.getCalculatedFieldByRelation(id);
    if (calculatedFields.length > 0) {
      await this.modelColumnRepository.deleteMany(
        calculatedFields.map((f) => f.id),
      );
    }
    await this.relationRepository.deleteOne(id);
  }

  public async getCalculatedFieldByRelation(
    relationId: number,
  ): Promise<ModelColumn[]> {
    const calculatedFields = await this.modelColumnRepository.findAllBy({
      isCalculated: true,
    });
    const relatedCalculatedFields = calculatedFields.reduce<ModelColumn[]>(
      (acc, field) => {
        const lineage = safeParseJson(field.lineage || '[]') as number[];
        const relationIds = lineage.slice(0, lineage.length - 1);
        if (relationIds.includes(relationId)) {
          acc.push(field);
        }
        return acc;
      },
      [],
    );
    return relatedCalculatedFields;
  }

  public async validateCalculatedFieldNaming(
    displayName: string,
    modelId: number,
    columnId?: number,
  ): Promise<ValidateCalculatedFieldResponse> {
    // only allow uppercase/lowercase english, numbers, syntaxes in the first raw of keyboard, {}, [], ', ", ,, .
    const validationRes = validateDisplayName(displayName);
    if (!validationRes.valid) {
      return {
        valid: false,
        message: validationRes.message || 'Invalid Calculated field name',
      };
    }

    // can not duplicated with existed column
    const referenceName =
      this.generateReferenceNameFromDisplayName(displayName);
    let existedColumns = await this.modelColumnRepository.findColumnsByModelIds(
      [modelId],
    );
    if (columnId) {
      existedColumns = existedColumns.filter(
        (column) => column.id !== columnId,
      );
    }
    if (
      existedColumns.find((column) => column.referenceName === referenceName)
    ) {
      return {
        valid: false,
        message: `The generated calculated field name "${referenceName}" is duplicated with existed column, please change the name and try again`,
      };
    }
    return { valid: true };
  }

  public async deleteAllViewsByProjectId(
    bridgeProjectId: number,
  ): Promise<void> {
    // delete all views
    await this.viewRepository.deleteAllBy({ projectId: bridgeProjectId });
  }

  public async deleteAllModelsByProjectId(
    bridgeProjectId: number,
  ): Promise<void> {
    // delete all relations
    await this.relationRepository.deleteAllBy({
      projectId: bridgeProjectId,
    });

    // delete all models
    await this.modelRepository.deleteAllBy({
      projectId: bridgeProjectId,
    });
  }

  private generateReferenceNameFromDisplayName(displayName: string) {
    // replace all syntaxes that [in the first raw of keyboard, {}, [], ', ", ,, . ] with _
    return replaceAllowableSyntax(displayName);
  }

  private generateRelationName(
    relation: RelationData,
    models: Model[],
    columns: ModelColumn[],
  ) {
    const fromModel = models.find((m) => m.id === relation.fromModelId);
    const toModel = models.find((m) => m.id === relation.toModelId);
    if (!fromModel || !toModel) {
      throw new Error('Model not found');
    }

    const fromColumn = columns.find(
      (column) => column.id === relation.fromColumnId,
    );
    const toColumn = columns.find(
      (column) => column.id === relation.toColumnId,
    );
    if (!fromColumn || !toColumn) {
      throw new Error('Column not found');
    }

    return (
      capitalize(fromModel.sourceTableName) +
      capitalize(fromColumn.referenceName) +
      capitalize(toModel.sourceTableName) +
      capitalize(toColumn.referenceName)
    );
  }

  /** We currently support expression below, right side is the return type of the calculated field.
  Aggregations
    - **avg(***x***)** → double
    - **count(***x***)** → bigint
    - **max(***x***)** → [same as input]
    - **min(***x***)** → [same as input]
    - **sum(***x***)** → [same as input]
  Math functions
    - **abs(***x***)** → [same as input]
    - **cbrt(***x***)** → double
    - **ceil(***x***)** → [same as input]
    - **exp(***x***)** → double
    - **floor(***x***)** → [same as input]
    - **ln(***x***)** → double
    - **log10(***x***)** → double
    - **round(***x***)** → [same as input]
    - **sign(***x***)** → [same as input]

  String functions
    - **length(***string***)** → bigint
    - **reverse(**string**)** → varbinary
  */
  private async inferCalculatedFieldDataType(
    expression: ExpressionName,
    inputFieldId: number,
  ) {
    let type = null;
    switch (expression) {
      case ExpressionName.CEIL:
      case ExpressionName.FLOOR:
      case ExpressionName.ROUND:
      case ExpressionName.SIGN:
      case ExpressionName.SUM:
      case ExpressionName.MAX:
      case ExpressionName.MIN:
      case ExpressionName.ABS:
        type = await this.getFieldDataType(inputFieldId);
        break;
      case ExpressionName.CBRT:
      case ExpressionName.EXP:
      case ExpressionName.AVG:
      case ExpressionName.LN:
      case ExpressionName.LOG10:
        type = 'DOUBLE';
        break;
      case ExpressionName.COUNT:
      case ExpressionName.LENGTH:
        type = 'BIGINT';
        break;
      case ExpressionName.REVERSE:
        type = 'VARBINARY';
        break;
      default:
        throw new Error('Unsupported expression');
    }
    return type;
  }

  private async getFieldDataType(fieldId: number): Promise<string> {
    const field = await this.modelColumnRepository.findOneBy({ id: fieldId });
    if (!field) {
      throw new Error('Field not found');
    }
    return field.type;
  }

  private async checkCalculatedFieldCanQuery(
    modelId: number,
    modelName: string,
    data: CheckCalculatedFieldCanQueryData,
  ) {
    const model = await this.modelRepository.findOneBy({ id: modelId });
    if (!model) {
      throw new Error('Model not found');
    }
    const runtimeIdentity = toPersistedRuntimeIdentityPatch(model);
    const { project, mdlBuilder } =
      await this.mdlService.makeCurrentModelMDLByRuntimeIdentity(
        runtimeIdentity,
      );
    const { referenceName, expression, lineage } = data;
    const inputFieldId = lineage[lineage.length - 1];
    const dataType = await this.inferCalculatedFieldDataType(
      expression,
      inputFieldId,
    );

    // add temporary calculated field
    const modelColumn = {
      id: 99999999,
      modelId,
      displayName: referenceName,
      sourceColumnName: referenceName,
      referenceName: referenceName,
      type: dataType,
      isCalculated: true,
      isPk: false,
      notNull: false,
      aggregation: expression,
      lineage: JSON.stringify(lineage),
      properties: JSON.stringify({ description: '' }),
    } as ModelColumn;
    mdlBuilder.insertCalculatedField(modelName, modelColumn);
    const manifest = mdlBuilder.getManifest();

    // find the calculated field in manifest
    const calculatedField = (manifest.models || [])
      .find((m) => m.name === modelName)
      ?.columns?.find((c) => c.name === referenceName);

    logger.debug(`Calculated field MDL: ${JSON.stringify(calculatedField)}`);

    // validate calculated field can query
    const connectionType = project.type;
    if (connectionType === DataSourceName.DUCKDB) {
      return await this.wrenEngineAdaptor.validateColumnIsValid(
        manifest,
        modelName,
        referenceName,
      );
    } else {
      const parameters = { modelName, columnName: referenceName };
      return await this.queryService.validate(
        project,
        ValidationRules.COLUMN_IS_VALID,
        manifest,
        parameters,
      );
    }
  }

  private async validateCreateRelation(
    models: Model[],
    columns: ModelColumn[],
    relation: RelationData,
  ) {
    const crossProjectError = this.validateRelationProjectConsistency(models);
    if (crossProjectError) {
      return crossProjectError;
    }

    const syncValidation = this.validateCreateRelationSync(
      models,
      columns,
      relation,
    );
    if (!syncValidation.valid) {
      return syncValidation;
    }

    const existedRelations =
      await this.relationRepository.findExistedRelationBetweenModels(relation);

    if (existedRelations.length > 0) {
      return {
        valid: false,
        message: 'This relationship already exists.',
      };
    }

    return { valid: true };
  }

  private validateCreateRelationSync(
    models: Model[],
    columns: ModelColumn[],
    relation: RelationData,
  ) {
    const { fromModelId, fromColumnId, toModelId, toColumnId } = relation;
    const fromModel = models.find((m) => m.id === fromModelId);
    const toModel = models.find((m) => m.id === toModelId);
    // model should exist
    if (!fromModel) {
      return {
        valid: false,
        message: `Model not found: fromModelId ${fromModelId}`,
      };
    }
    if (!toModel) {
      return {
        valid: false,
        message: `Model not found: toModelId ${toModelId}`,
      };
    }
    // column should exist
    const fromColumn = columns.find((column) => column.id === fromColumnId);
    const toColumn = columns.find((column) => column.id === toColumnId);
    if (!fromColumn) {
      return {
        valid: false,
        message: `Column not found, column Id ${fromColumnId}`,
      };
    }
    if (!toColumn) {
      return {
        valid: false,
        message: `Column not found, column Id ${toColumnId}`,
      };
    }

    // column should belong to the model
    if (toColumn.modelId != toModelId) {
      return {
        valid: false,
        message: `Column not belong to the model, column Id ${toColumnId}`,
      };
    }
    if (fromColumn.modelId != fromModelId) {
      return {
        valid: false,
        message: `Column not belong to the model, column Id ${fromColumnId}`,
      };
    }

    return { valid: true };
  }

  private requireSingleProjectBridgeForRelations(
    models: Model[],
    modelIds: number[],
  ) {
    if (models.length !== modelIds.length) {
      throw new Error('Model not found');
    }

    const consistencyError = this.validateRelationProjectConsistency(models);
    if (consistencyError) {
      throw new Error(consistencyError.message);
    }

    const bridgeProjectId = models[0]?.projectId;
    if (!bridgeProjectId) {
      throw new Error('Model not found');
    }

    return bridgeProjectId;
  }

  private resolveRuntimeRelationProjectBridgeFallback(
    runtimeIdentity: PersistedRuntimeIdentity,
    models: Model[],
  ) {
    if (hasCanonicalRuntimeIdentity(runtimeIdentity)) {
      return null;
    }

    const bridgeProjectId = resolvePersistedProjectBridgeId(
      runtimeIdentity,
      models[0]?.projectId ?? null,
    );
    if (!bridgeProjectId) {
      throw new Error('Model not found');
    }
    if (
      models.some(
        (model) => (model.projectId ?? bridgeProjectId) !== bridgeProjectId,
      )
    ) {
      throw new Error('Relations must belong to a single project');
    }

    return bridgeProjectId;
  }

  private resolveRelationProjectBridgeForPersistence(
    models: Model[],
    runtimeIdentity: PersistedRuntimeIdentity,
  ) {
    const consistencyError = this.validateRelationProjectConsistency(models);
    if (consistencyError) {
      throw new Error(consistencyError.message);
    }

    return resolvePersistedProjectBridgeId(
      { projectId: models[0]?.projectId ?? null },
      resolvePersistedProjectBridgeId(runtimeIdentity),
    );
  }

  private validateRelationProjectConsistency(models: Model[]) {
    if (models.length === 0) {
      return { valid: false, message: 'Model not found' };
    }

    const relationProjectBridgeId = models[0].projectId;
    if (models.some((model) => model.projectId !== relationProjectBridgeId)) {
      return {
        valid: false,
        message: 'Relations must belong to a single project',
      };
    }

    return null;
  }

  private filterRecordsByRuntimeIdentityScope<
    T extends { projectId?: number | null },
  >(records: T[], runtimeIdentity: PersistedRuntimeIdentity): T[] {
    return records.filter((record) =>
      this.matchesRuntimeIdentityScope(record, runtimeIdentity),
    );
  }

  private matchesRuntimeIdentityScope(
    record: { projectId?: number | null },
    runtimeIdentity: PersistedRuntimeIdentity,
  ): boolean {
    if (hasCanonicalRuntimeIdentity(runtimeIdentity)) {
      return true;
    }

    return (
      record.projectId === resolvePersistedProjectBridgeId(runtimeIdentity)
    );
  }

  private validateViewNameAgainstViews(
    views: View[],
    referenceName: string,
    selfView?: number,
  ): ValidateCalculatedFieldResponse {
    if (
      views.find((view) => view.name === referenceName && view.id !== selfView)
    ) {
      return {
        valid: false,
        message: `Generated view name "${referenceName}" is duplicated`,
      };
    }

    return {
      valid: true,
    };
  }
}
