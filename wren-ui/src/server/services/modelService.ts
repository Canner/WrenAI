import { SampleDatasetTable } from '@server/data';
import { RelationData, UpdateRelationData } from '@server/types';
import {
  CreateCalculatedFieldData,
  UpdateCalculatedFieldData,
} from '@server/models';
import { PersistedRuntimeIdentity } from '@server/context/runtimeScope';
import { toProjectBridgeRuntimeIdentity } from '@server/utils/persistedRuntimeIdentity';
import { Model, ModelColumn, Relation, View } from '@server/repositories';
import {
  createCalculatedFieldByRuntimeIdentity,
  updateCalculatedFieldByRuntimeIdentity,
  validateCalculatedFieldNaming,
} from './modelServiceCalculatedFieldSupport';
import {
  createRelation,
  createRelationByRuntimeIdentity,
  deleteRelationByRuntimeIdentity,
  getCalculatedFieldByRelation,
  saveRelations,
  saveRelationsByRuntimeIdentity,
  updateRelationByRuntimeIdentity,
} from './modelServiceRelationSupport';
import {
  getColumnByRuntimeIdentity,
  getModelByRuntimeIdentity,
  getModelsByRuntimeIdentity,
  getRelationByRuntimeIdentity,
  getViewByRuntimeIdentity,
  getViewsByRuntimeIdentity,
  listModelsByRuntimeIdentity,
} from './modelServiceRuntimeScopeSupport';
import { validateViewNameByRuntimeIdentity } from './modelServiceViewSupport';
import {
  batchUpdateColumnProperties,
  batchUpdateModelProperties,
  generateReferenceName,
  updatePrimaryKeys,
} from './modelServiceDatasetSupport';

export type {
  GenerateReferenceNameData,
  IModelService,
  ModelServiceConstructorArgs,
  ValidateCalculatedFieldResponse,
} from './modelServiceTypes';
import type {
  GenerateReferenceNameData,
  IModelService,
  ModelServiceConstructorArgs,
  ModelServiceDependencies,
  ValidateCalculatedFieldResponse,
} from './modelServiceTypes';

export class ModelService implements IModelService {
  private readonly deps: ModelServiceDependencies;

  constructor(deps: ModelServiceConstructorArgs) {
    this.deps = deps;
  }

  public async createCalculatedFieldScoped(
    bridgeProjectId: number,
    data: CreateCalculatedFieldData,
  ): Promise<ModelColumn> {
    return createCalculatedFieldByRuntimeIdentity(
      this.deps,
      toProjectBridgeRuntimeIdentity(bridgeProjectId),
      data,
    );
  }

  public async createCalculatedFieldByRuntimeIdentity(
    runtimeIdentity: PersistedRuntimeIdentity,
    data: CreateCalculatedFieldData,
  ): Promise<ModelColumn> {
    return createCalculatedFieldByRuntimeIdentity(
      this.deps,
      runtimeIdentity,
      data,
    );
  }

  public async listModelsByRuntimeIdentity(
    runtimeIdentity: PersistedRuntimeIdentity,
  ): Promise<Model[]> {
    return listModelsByRuntimeIdentity(this.deps, runtimeIdentity);
  }

  public async getModelsByRuntimeIdentity(
    runtimeIdentity: PersistedRuntimeIdentity,
    modelIds: number[],
  ): Promise<Model[]> {
    return getModelsByRuntimeIdentity(this.deps, runtimeIdentity, modelIds);
  }

  public async getModelByRuntimeIdentity(
    runtimeIdentity: PersistedRuntimeIdentity,
    modelId: number,
  ): Promise<Model | null> {
    return getModelByRuntimeIdentity(this.deps, runtimeIdentity, modelId);
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
    const column = await getColumnByRuntimeIdentity(
      this.deps,
      toProjectBridgeRuntimeIdentity(bridgeProjectId),
      columnId,
    );
    if (!column) {
      return null;
    }

    const model = await this.getModelScoped(bridgeProjectId, column.modelId);
    return model ? column : null;
  }

  public async getColumnByRuntimeIdentity(
    runtimeIdentity: PersistedRuntimeIdentity,
    columnId: number,
  ): Promise<ModelColumn | null> {
    return getColumnByRuntimeIdentity(this.deps, runtimeIdentity, columnId);
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
    return getViewsByRuntimeIdentity(this.deps, runtimeIdentity);
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
    return getViewByRuntimeIdentity(this.deps, runtimeIdentity, viewId);
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
    return getRelationByRuntimeIdentity(this.deps, runtimeIdentity, relationId);
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
    return validateViewNameByRuntimeIdentity(
      this.deps,
      runtimeIdentity,
      viewDisplayName,
      selfView,
    );
  }

  public async updateCalculatedFieldScoped(
    bridgeProjectId: number,
    data: UpdateCalculatedFieldData,
    id: number,
  ): Promise<ModelColumn> {
    return updateCalculatedFieldByRuntimeIdentity(
      this.deps,
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
    return updateCalculatedFieldByRuntimeIdentity(
      this.deps,
      runtimeIdentity,
      data,
      id,
    );
  }

  public async updatePrimaryKeys(
    bridgeProjectId: number,
    tables: SampleDatasetTable[],
  ): Promise<void> {
    return updatePrimaryKeys(this.deps, bridgeProjectId, tables);
  }

  public async batchUpdateModelProperties(
    bridgeProjectId: number,
    tables: SampleDatasetTable[],
  ): Promise<void> {
    return batchUpdateModelProperties(this.deps, bridgeProjectId, tables);
  }

  public async batchUpdateColumnProperties(
    bridgeProjectId: number,
    tables: SampleDatasetTable[],
  ): Promise<void> {
    return batchUpdateColumnProperties(this.deps, bridgeProjectId, tables);
  }

  public generateReferenceName(data: GenerateReferenceNameData): string {
    return generateReferenceName(data);
  }

  public async saveRelations(relations: RelationData[]): Promise<Relation[]> {
    return saveRelations(this.deps, relations);
  }

  public async saveRelationsByRuntimeIdentity(
    runtimeIdentity: PersistedRuntimeIdentity,
    relations: RelationData[],
    options: { preserveProjectBridge?: boolean } = {},
  ): Promise<Relation[]> {
    return saveRelationsByRuntimeIdentity(
      this.deps,
      runtimeIdentity,
      relations,
      options,
    );
  }

  public async createRelation(relation: RelationData): Promise<Relation> {
    return createRelation(this.deps, relation);
  }

  public async createRelationByRuntimeIdentity(
    runtimeIdentity: PersistedRuntimeIdentity,
    relation: RelationData,
  ): Promise<Relation> {
    return createRelationByRuntimeIdentity(
      this.deps,
      runtimeIdentity,
      relation,
    );
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
    return updateRelationByRuntimeIdentity(
      this.deps,
      runtimeIdentity,
      relation,
      id,
    );
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
    await deleteRelationByRuntimeIdentity(this.deps, runtimeIdentity, id);
  }

  public async getCalculatedFieldByRelation(
    relationId: number,
  ): Promise<ModelColumn[]> {
    return getCalculatedFieldByRelation(this.deps, relationId);
  }

  public async validateCalculatedFieldNaming(
    displayName: string,
    modelId: number,
    columnId?: number,
  ): Promise<ValidateCalculatedFieldResponse> {
    return validateCalculatedFieldNaming(
      this.deps,
      displayName,
      modelId,
      columnId,
    );
  }

  public async deleteAllViewsByProjectId(
    bridgeProjectId: number,
  ): Promise<void> {
    await this.deps.viewRepository.deleteAllBy({ projectId: bridgeProjectId });
  }

  public async deleteAllModelsByProjectId(
    bridgeProjectId: number,
  ): Promise<void> {
    await this.deps.relationRepository.deleteAllBy({
      projectId: bridgeProjectId,
    });
    await this.deps.modelRepository.deleteAllBy({
      projectId: bridgeProjectId,
    });
  }
}
