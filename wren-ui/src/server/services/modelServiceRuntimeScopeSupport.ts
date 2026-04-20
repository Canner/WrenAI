import { PersistedRuntimeIdentity } from '@server/context/runtimeScope';
import {
  hasCanonicalRuntimeIdentity,
  resolvePersistedProjectBridgeId,
} from '@server/utils/persistedRuntimeIdentity';
import { Model, ModelColumn, Relation, View } from '@server/repositories';
import {
  ModelServiceDependencies,
  RuntimeScopedRecord,
} from './modelServiceTypes';

export const matchesRuntimeIdentityScope = (
  record: RuntimeScopedRecord,
  runtimeIdentity: PersistedRuntimeIdentity,
): boolean => {
  if (hasCanonicalRuntimeIdentity(runtimeIdentity)) {
    return true;
  }

  return record.projectId === resolvePersistedProjectBridgeId(runtimeIdentity);
};

export const filterRecordsByRuntimeIdentityScope = <
  T extends RuntimeScopedRecord,
>(
  records: T[],
  runtimeIdentity: PersistedRuntimeIdentity,
): T[] =>
  records.filter((record) =>
    matchesRuntimeIdentityScope(record, runtimeIdentity),
  );

export const listModelsByRuntimeIdentity = async (
  deps: ModelServiceDependencies,
  runtimeIdentity: PersistedRuntimeIdentity,
): Promise<Model[]> =>
  deps.modelRepository.findAllByRuntimeIdentity(runtimeIdentity);

export const getModelsByRuntimeIdentity = async (
  deps: ModelServiceDependencies,
  runtimeIdentity: PersistedRuntimeIdentity,
  modelIds: number[],
): Promise<Model[]> => {
  const uniqueModelIds = [...new Set(modelIds)];
  const models = await deps.modelRepository.findAllByIdsWithRuntimeIdentity(
    uniqueModelIds,
    runtimeIdentity,
  );
  const scopedModels = filterRecordsByRuntimeIdentityScope(
    models,
    runtimeIdentity,
  );
  if (scopedModels.length !== uniqueModelIds.length) {
    return [];
  }

  return scopedModels;
};

export const getModelByRuntimeIdentity = async (
  deps: ModelServiceDependencies,
  runtimeIdentity: PersistedRuntimeIdentity,
  modelId: number,
): Promise<Model | null> => {
  const [model] = await getModelsByRuntimeIdentity(deps, runtimeIdentity, [
    modelId,
  ]);
  return model || null;
};

export const getColumnByRuntimeIdentity = async (
  deps: ModelServiceDependencies,
  runtimeIdentity: PersistedRuntimeIdentity,
  columnId: number,
): Promise<ModelColumn | null> => {
  const column = await deps.modelColumnRepository.findOneBy({ id: columnId });
  if (!column) {
    return null;
  }

  const model = await getModelByRuntimeIdentity(
    deps,
    runtimeIdentity,
    column.modelId,
  );
  return model ? column : null;
};

export const getViewsByRuntimeIdentity = async (
  deps: ModelServiceDependencies,
  runtimeIdentity: PersistedRuntimeIdentity,
): Promise<View[]> => {
  const views =
    await deps.viewRepository.findAllByRuntimeIdentity(runtimeIdentity);
  return filterRecordsByRuntimeIdentityScope(views, runtimeIdentity);
};

export const getViewByRuntimeIdentity = async (
  deps: ModelServiceDependencies,
  runtimeIdentity: PersistedRuntimeIdentity,
  viewId: number,
): Promise<View | null> => {
  const view = await deps.viewRepository.findOneByIdWithRuntimeIdentity(
    viewId,
    runtimeIdentity,
  );
  if (view && !matchesRuntimeIdentityScope(view, runtimeIdentity)) {
    return null;
  }

  return view;
};

export const getRelationByRuntimeIdentity = async (
  deps: ModelServiceDependencies,
  runtimeIdentity: PersistedRuntimeIdentity,
  relationId: number,
): Promise<Relation | null> => {
  const relation = await deps.relationRepository.findOneByIdWithRuntimeIdentity(
    relationId,
    runtimeIdentity,
  );
  if (relation && !matchesRuntimeIdentityScope(relation, runtimeIdentity)) {
    return null;
  }

  return relation;
};
