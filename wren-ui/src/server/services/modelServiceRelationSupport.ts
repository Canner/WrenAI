import { capitalize, isEmpty } from 'lodash';
import { safeParseJson } from '@server/utils';
import { PersistedRuntimeIdentity } from '@server/context/runtimeScope';
import {
  hasCanonicalRuntimeIdentity,
  resolvePersistedProjectBridgeId,
  toPersistedRuntimeIdentityPatch,
} from '@server/utils/persistedRuntimeIdentity';
import { Model, ModelColumn, Relation } from '@server/repositories';
import { RelationData, UpdateRelationData } from '@server/types';
import { ModelServiceDependencies } from './modelServiceTypes';
import {
  getModelsByRuntimeIdentity,
  getRelationByRuntimeIdentity,
} from './modelServiceRuntimeScopeSupport';

const validateRelationProjectConsistency = (models: Model[]) => {
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
};

const requireSingleProjectBridgeForRelations = (
  models: Model[],
  modelIds: number[],
) => {
  if (models.length !== modelIds.length) {
    throw new Error('Model not found');
  }

  const consistencyError = validateRelationProjectConsistency(models);
  if (consistencyError) {
    throw new Error(consistencyError.message);
  }

  const bridgeProjectId = models[0]?.projectId;
  if (!bridgeProjectId) {
    throw new Error('Model not found');
  }

  return bridgeProjectId;
};

const resolveRuntimeRelationProjectBridgeFallback = (
  runtimeIdentity: PersistedRuntimeIdentity,
  models: Model[],
) => {
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
};

const resolveRelationProjectBridgeForPersistence = (
  models: Model[],
  runtimeIdentity: PersistedRuntimeIdentity,
) => {
  const consistencyError = validateRelationProjectConsistency(models);
  if (consistencyError) {
    throw new Error(consistencyError.message);
  }

  return resolvePersistedProjectBridgeId(
    { projectId: models[0]?.projectId ?? null },
    resolvePersistedProjectBridgeId(runtimeIdentity),
  );
};

const validateCreateRelationSync = (
  models: Model[],
  columns: ModelColumn[],
  relation: RelationData,
) => {
  const { fromModelId, fromColumnId, toModelId, toColumnId } = relation;
  const fromModel = models.find((model) => model.id === fromModelId);
  const toModel = models.find((model) => model.id === toModelId);
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
  if (toColumn.modelId !== toModelId) {
    return {
      valid: false,
      message: `Column not belong to the model, column Id ${toColumnId}`,
    };
  }
  if (fromColumn.modelId !== fromModelId) {
    return {
      valid: false,
      message: `Column not belong to the model, column Id ${fromColumnId}`,
    };
  }

  return { valid: true };
};

const validateCreateRelation = async (
  deps: ModelServiceDependencies,
  models: Model[],
  columns: ModelColumn[],
  relation: RelationData,
) => {
  const crossProjectError = validateRelationProjectConsistency(models);
  if (crossProjectError) {
    return crossProjectError;
  }

  const syncValidation = validateCreateRelationSync(models, columns, relation);
  if (!syncValidation.valid) {
    return syncValidation;
  }

  const existedRelations =
    await deps.relationRepository.findExistedRelationBetweenModels(relation);
  if (existedRelations.length > 0) {
    return {
      valid: false,
      message: 'This relationship already exists.',
    };
  }

  return { valid: true };
};

const generateRelationName = (
  relation: RelationData,
  models: Model[],
  columns: ModelColumn[],
) => {
  const fromModel = models.find((model) => model.id === relation.fromModelId);
  const toModel = models.find((model) => model.id === relation.toModelId);
  if (!fromModel || !toModel) {
    throw new Error('Model not found');
  }

  const fromColumn = columns.find(
    (column) => column.id === relation.fromColumnId,
  );
  const toColumn = columns.find((column) => column.id === relation.toColumnId);
  if (!fromColumn || !toColumn) {
    throw new Error('Column not found');
  }

  return (
    capitalize(fromModel.sourceTableName) +
    capitalize(fromColumn.referenceName) +
    capitalize(toModel.sourceTableName) +
    capitalize(toColumn.referenceName)
  );
};

const getRelationColumns = async (
  deps: ModelServiceDependencies,
  relations: Array<RelationData>,
) => {
  const columnIds = relations
    .map(({ fromColumnId, toColumnId }) => [fromColumnId, toColumnId])
    .flat();
  const uniqueColumnIds = [...new Set(columnIds)];
  const columns =
    await deps.modelColumnRepository.findColumnsByIds(uniqueColumnIds);
  if (columns.length !== uniqueColumnIds.length) {
    throw new Error('Column not found');
  }
  return columns;
};

export const getCalculatedFieldByRelation = async (
  deps: ModelServiceDependencies,
  relationId: number,
): Promise<ModelColumn[]> => {
  const calculatedFields = await deps.modelColumnRepository.findAllBy({
    isCalculated: true,
  });
  return calculatedFields.reduce<ModelColumn[]>((acc, field) => {
    const lineage = safeParseJson(field.lineage || '[]') as number[];
    const relationIds = lineage.slice(0, lineage.length - 1);
    if (relationIds.includes(relationId)) {
      acc.push(field);
    }
    return acc;
  }, []);
};

export const saveRelations = async (
  deps: ModelServiceDependencies,
  relations: RelationData[],
): Promise<Relation[]> => {
  if (isEmpty(relations)) {
    return [];
  }

  const modelIds = relations
    .map(({ fromModelId, toModelId }) => [fromModelId, toModelId])
    .flat();
  const uniqueModelIds = [...new Set(modelIds)];
  const models = await deps.modelRepository.findAllByIds(uniqueModelIds);
  const bridgeProjectId = requireSingleProjectBridgeForRelations(
    models,
    uniqueModelIds,
  );
  const columns = await getRelationColumns(deps, relations);

  const relationValues = relations.map((relation) => {
    const { valid, message } = validateCreateRelationSync(
      models,
      columns,
      relation,
    );
    if (!valid) {
      throw new Error(message);
    }
    return {
      projectId: bridgeProjectId,
      name: generateRelationName(relation, models, columns),
      fromColumnId: relation.fromColumnId,
      toColumnId: relation.toColumnId,
      joinType: relation.type,
      properties: relation.description
        ? JSON.stringify({ description: relation.description })
        : null,
    } as Partial<Relation>;
  });

  return deps.relationRepository.createMany(relationValues);
};

export const saveRelationsByRuntimeIdentity = async (
  deps: ModelServiceDependencies,
  runtimeIdentity: PersistedRuntimeIdentity,
  relations: RelationData[],
  options: {
    preserveProjectBridge?: boolean;
  } = {},
): Promise<Relation[]> => {
  if (isEmpty(relations)) {
    return [];
  }

  const modelIds = relations
    .map(({ fromModelId, toModelId }) => [fromModelId, toModelId])
    .flat();
  const uniqueModelIds = [...new Set(modelIds)];
  const models = await getModelsByRuntimeIdentity(
    deps,
    runtimeIdentity,
    uniqueModelIds,
  );
  if (models.length !== uniqueModelIds.length) {
    throw new Error('Model not found');
  }

  const columns = await getRelationColumns(deps, relations);
  const bridgeProjectId = options.preserveProjectBridge
    ? resolveRelationProjectBridgeForPersistence(models, runtimeIdentity)
    : resolveRuntimeRelationProjectBridgeFallback(runtimeIdentity, models);
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
    const { valid, message } = validateCreateRelationSync(
      models,
      columns,
      relation,
    );
    if (!valid) {
      throw new Error(message);
    }
    return {
      ...runtimePatch,
      name: generateRelationName(relation, models, columns),
      fromColumnId: relation.fromColumnId,
      toColumnId: relation.toColumnId,
      joinType: relation.type,
      properties: relation.description
        ? JSON.stringify({ description: relation.description })
        : null,
    } as Partial<Relation>;
  });

  return deps.relationRepository.createMany(relationValues);
};

export const createRelation = async (
  deps: ModelServiceDependencies,
  relation: RelationData,
): Promise<Relation> => {
  const modelIds = [relation.fromModelId, relation.toModelId];
  const uniqueModelIds = [...new Set(modelIds)];
  const models = await deps.modelRepository.findAllByIds(uniqueModelIds);
  const bridgeProjectId = requireSingleProjectBridgeForRelations(
    models,
    uniqueModelIds,
  );
  const columns = await deps.modelColumnRepository.findColumnsByIds([
    relation.fromColumnId,
    relation.toColumnId,
  ]);
  if (
    columns.length !==
    [...new Set([relation.fromColumnId, relation.toColumnId])].length
  ) {
    throw new Error('Column not found');
  }

  const { valid, message } = await validateCreateRelation(
    deps,
    models,
    columns,
    relation,
  );
  if (!valid) {
    throw new Error(message);
  }

  return deps.relationRepository.createOne({
    projectId: bridgeProjectId,
    name: generateRelationName(relation, models, columns),
    fromColumnId: relation.fromColumnId,
    toColumnId: relation.toColumnId,
    joinType: relation.type,
  });
};

export const createRelationByRuntimeIdentity = async (
  deps: ModelServiceDependencies,
  runtimeIdentity: PersistedRuntimeIdentity,
  relation: RelationData,
): Promise<Relation> => {
  const modelIds = [relation.fromModelId, relation.toModelId];
  const models = await getModelsByRuntimeIdentity(
    deps,
    runtimeIdentity,
    modelIds,
  );
  if (models.length !== [...new Set(modelIds)].length) {
    throw new Error('Model not found');
  }

  const columnIds = [relation.fromColumnId, relation.toColumnId];
  const columns = await deps.modelColumnRepository.findColumnsByIds(columnIds);
  if (columns.length !== [...new Set(columnIds)].length) {
    throw new Error('Column not found');
  }

  const { valid, message } = validateCreateRelationSync(
    models,
    columns,
    relation,
  );
  if (!valid) {
    throw new Error(message);
  }

  const existedRelations =
    await deps.relationRepository.findExistedRelationBetweenModels(
      relation,
      runtimeIdentity,
    );
  if (existedRelations.length > 0) {
    throw new Error('This relationship already exists.');
  }

  return deps.relationRepository.createOne({
    ...toPersistedRuntimeIdentityPatch(runtimeIdentity),
    projectId: resolveRelationProjectBridgeForPersistence(
      models,
      runtimeIdentity,
    ),
    name: generateRelationName(relation, models, columns),
    fromColumnId: relation.fromColumnId,
    toColumnId: relation.toColumnId,
    joinType: relation.type,
    properties: relation.description
      ? JSON.stringify({ description: relation.description })
      : null,
  });
};

export const updateRelationByRuntimeIdentity = async (
  deps: ModelServiceDependencies,
  runtimeIdentity: PersistedRuntimeIdentity,
  relation: UpdateRelationData,
  id: number,
): Promise<Relation> => {
  const existing = await getRelationByRuntimeIdentity(
    deps,
    runtimeIdentity,
    id,
  );
  if (!existing) {
    throw new Error('Relation not found');
  }

  return deps.relationRepository.updateOne(id, {
    joinType: relation.type,
  });
};

export const deleteRelationByRuntimeIdentity = async (
  deps: ModelServiceDependencies,
  runtimeIdentity: PersistedRuntimeIdentity,
  id: number,
): Promise<void> => {
  const existing = await getRelationByRuntimeIdentity(
    deps,
    runtimeIdentity,
    id,
  );
  if (!existing) {
    throw new Error('Relation not found');
  }

  const calculatedFields = await getCalculatedFieldByRelation(deps, id);
  if (calculatedFields.length > 0) {
    await deps.modelColumnRepository.deleteMany(
      calculatedFields.map((field) => field.id),
    );
  }
  await deps.relationRepository.deleteOne(id);
};
