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
import { RelationData, UpdateRelationData } from '@server/types';
import {
  CheckCalculatedFieldCanQueryData,
  CreateCalculatedFieldData,
  UpdateCalculatedFieldData,
} from '@server/models';
import { IMDLService } from './mdlService';
import { IWrenEngineAdaptor } from '../adaptors/wrenEngineAdaptor';
import { IQueryService } from './queryService';
import { PersistedRuntimeIdentity } from '@server/context/runtimeScope';

export interface ValidateCalculatedFieldResponse {
  valid: boolean;
  message?: string;
}

export interface GenerateReferenceNameData {
  displayName: string;
  sourceTableName: string;
  existedReferenceNames: string[];
}

export interface ModelServiceConstructorArgs {
  projectService: unknown;
  modelRepository: IModelRepository;
  modelColumnRepository: IModelColumnRepository;
  relationRepository: IRelationRepository;
  viewRepository: IViewRepository;
  mdlService: IMDLService;
  wrenEngineAdaptor: IWrenEngineAdaptor;
  queryService: IQueryService;
}

export type ModelServiceDependencies = ModelServiceConstructorArgs;

export type RuntimeScopedRecord = {
  projectId?: number | null;
};

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
  generateReferenceName(data: GenerateReferenceNameData): string;
  validateCalculatedFieldNaming(
    name: string,
    modelId: number,
    columnId?: number,
  ): Promise<ValidateCalculatedFieldResponse>;
  deleteAllViewsByProjectId(bridgeProjectId: number): Promise<void>;
  deleteAllModelsByProjectId(bridgeProjectId: number): Promise<void>;
}

export interface ModelServiceCalculatedFieldInput {
  referenceName: string;
  expression: CheckCalculatedFieldCanQueryData['expression'];
  lineage: CheckCalculatedFieldCanQueryData['lineage'];
}
