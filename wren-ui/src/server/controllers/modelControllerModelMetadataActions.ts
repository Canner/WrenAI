import { UpdateModelMetadataInput } from '../models';
import { IContext } from '../types';
import { Model } from '../repositories';
import { isEmpty, isNil } from 'lodash';
import { TelemetryEvent } from '../telemetry/telemetry';

interface ModelControllerMetadataDeps {
  assertExecutableRuntimeScope: (
    ctx: IContext,
    runtimeScope?: IContext['runtimeScope'],
  ) => Promise<void>;
  assertKnowledgeBaseWriteAccess: (ctx: IContext) => Promise<void>;
  ensureModelScope: (
    ctx: IContext,
    modelId: number,
    errorMessage?: string,
  ) => Promise<Model>;
  recordKnowledgeBaseWriteAudit: (
    ctx: IContext,
    args: {
      resourceType: string;
      resourceId?: string | number | null;
      afterJson?: Record<string, any> | null;
      payloadJson?: Record<string, any> | null;
    },
  ) => Promise<void>;
  determineMetadataValue: (value: string) => string | null;
}

const handleUpdateModelMetadata = async (
  data: UpdateModelMetadataInput,
  model: Model,
  ctx: IContext,
  modelId: number,
  determineMetadataValue: (value: string) => string | null,
) => {
  const modelMetadata: any = {};

  if (!isNil(data.displayName)) {
    modelMetadata.displayName = determineMetadataValue(data.displayName);
  }

  if (!isNil(data.description)) {
    const properties = isNil(model.properties)
      ? {}
      : JSON.parse(model.properties);
    properties.description = determineMetadataValue(data.description);
    modelMetadata.properties = JSON.stringify(properties);
  }

  if (!isEmpty(modelMetadata)) {
    await ctx.modelRepository.updateOne(modelId, modelMetadata);
  }
};

const handleUpdateRelationshipMetadata = async (
  data: UpdateModelMetadataInput,
  ctx: IContext,
  determineMetadataValue: (value: string) => string | null,
) => {
  const relationshipIds = data.relationships.map(
    (relationship) => relationship.id,
  );
  const relationships =
    await ctx.relationRepository.findRelationsByIds(relationshipIds);
  for (const relation of relationships) {
    const requestedMetadata = data.relationships.find(
      (relationship) => relationship.id === relation.id,
    );
    if (!requestedMetadata) continue;

    const relationMetadata: any = {};
    if (!isNil(requestedMetadata.description)) {
      const properties = relation.properties
        ? JSON.parse(relation.properties)
        : {};
      properties.description = determineMetadataValue(
        requestedMetadata.description,
      );
      relationMetadata.properties = JSON.stringify(properties);
    }

    if (!isEmpty(relationMetadata)) {
      await ctx.relationRepository.updateOne(relation.id, relationMetadata);
    }
  }
};

const handleUpdateCFMetadata = async (
  data: UpdateModelMetadataInput,
  ctx: IContext,
  determineMetadataValue: (value: string) => string | null,
) => {
  const calculatedFieldIds = data.calculatedFields.map((field) => field.id);
  const modelColumns =
    await ctx.modelColumnRepository.findColumnsByIds(calculatedFieldIds);
  for (const column of modelColumns) {
    const requestedMetadata = data.calculatedFields.find(
      (field) => field.id === column.id,
    );
    if (!requestedMetadata) continue;

    const columnMetadata: any = {};
    if (!isNil(requestedMetadata.description)) {
      const properties = column.properties ? JSON.parse(column.properties) : {};
      properties.description = determineMetadataValue(
        requestedMetadata.description,
      );
      columnMetadata.properties = JSON.stringify(properties);
    }

    if (!isEmpty(columnMetadata)) {
      await ctx.modelColumnRepository.updateOne(column.id, columnMetadata);
    }
  }
};

const handleUpdateColumnMetadata = async (
  data: UpdateModelMetadataInput,
  ctx: IContext,
  determineMetadataValue: (value: string) => string | null,
) => {
  const columnIds = data.columns.map((column) => column.id);
  const modelColumns =
    await ctx.modelColumnRepository.findColumnsByIds(columnIds);
  for (const column of modelColumns) {
    const requestedMetadata = data.columns.find(
      (item) => item.id === column.id,
    );
    if (!requestedMetadata) continue;

    const columnMetadata: any = {};
    if (!isNil(requestedMetadata.displayName)) {
      columnMetadata.displayName = determineMetadataValue(
        requestedMetadata.displayName,
      );
    }
    if (!isNil(requestedMetadata.description)) {
      const properties = column.properties ? JSON.parse(column.properties) : {};
      properties.description = determineMetadataValue(
        requestedMetadata.description,
      );
      columnMetadata.properties = JSON.stringify(properties);
    }

    if (!isEmpty(columnMetadata)) {
      await ctx.modelColumnRepository.updateOne(column.id, columnMetadata);
    }
  }
};

const handleUpdateNestedColumnMetadata = async (
  data: UpdateModelMetadataInput,
  ctx: IContext,
  determineMetadataValue: (value: string) => string | null,
) => {
  const nestedColumnIds = data.nestedColumns.map((column) => column.id);
  const modelNestedColumns =
    await ctx.modelNestedColumnRepository.findNestedColumnsByIds(
      nestedColumnIds,
    );
  for (const column of modelNestedColumns) {
    const requestedMetadata = data.nestedColumns.find(
      (item) => item.id === column.id,
    );
    if (!requestedMetadata) continue;

    const nestedColumnMetadata: any = {};
    if (!isNil(requestedMetadata.displayName)) {
      nestedColumnMetadata.displayName = determineMetadataValue(
        requestedMetadata.displayName,
      );
    }
    if (!isNil(requestedMetadata.description)) {
      nestedColumnMetadata.properties = {
        ...column.properties,
        description: determineMetadataValue(requestedMetadata.description),
      };
    }

    if (!isEmpty(nestedColumnMetadata)) {
      await ctx.modelNestedColumnRepository.updateOne(
        column.id,
        nestedColumnMetadata,
      );
    }
  }
};

export const updateModelMetadataAction = async ({
  modelId,
  data,
  ctx,
  deps,
}: {
  modelId: number;
  data: UpdateModelMetadataInput;
  ctx: IContext;
  deps: ModelControllerMetadataDeps;
}): Promise<boolean> => {
  await deps.assertExecutableRuntimeScope(ctx);
  await deps.assertKnowledgeBaseWriteAccess(ctx);

  const model = await deps.ensureModelScope(ctx, modelId);
  const eventName = TelemetryEvent.MODELING_UPDATE_MODEL_METADATA;
  try {
    await handleUpdateModelMetadata(
      data,
      model,
      ctx,
      modelId,
      deps.determineMetadataValue,
    );

    if (!isEmpty(data.columns)) {
      await handleUpdateColumnMetadata(data, ctx, deps.determineMetadataValue);
    }
    if (!isEmpty(data.nestedColumns)) {
      await handleUpdateNestedColumnMetadata(
        data,
        ctx,
        deps.determineMetadataValue,
      );
    }
    if (!isEmpty(data.calculatedFields)) {
      await handleUpdateCFMetadata(data, ctx, deps.determineMetadataValue);
    }
    if (!isEmpty(data.relationships)) {
      await handleUpdateRelationshipMetadata(
        data,
        ctx,
        deps.determineMetadataValue,
      );
    }

    ctx.telemetry.sendEvent(eventName, { data });
    await deps.recordKnowledgeBaseWriteAudit(ctx, {
      resourceType: 'model',
      resourceId: modelId,
      payloadJson: { operation: 'update_model_metadata' },
    });
    return true;
  } catch (err: any) {
    ctx.telemetry.sendEvent(
      eventName,
      { data, error: err.message },
      err.extensions?.service,
      false,
    );
    throw err;
  }
};
