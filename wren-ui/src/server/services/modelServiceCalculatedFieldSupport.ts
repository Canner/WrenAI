import {
  safeParseJson,
  replaceAllowableSyntax,
  validateDisplayName,
  getLogger,
} from '@server/utils';
import {
  CheckCalculatedFieldCanQueryData,
  CreateCalculatedFieldData,
  ExpressionName,
  UpdateCalculatedFieldData,
} from '@server/models';
import { ValidationRules } from '@server/adaptors/ibisAdaptor';
import * as Errors from '@server/utils/error';
import { DataSourceName } from '@server/types';
import { ModelColumn } from '@server/repositories';
import { PersistedRuntimeIdentity } from '@server/context/runtimeScope';
import { toPersistedRuntimeIdentityPatch } from '@server/utils/persistedRuntimeIdentity';
import {
  ModelServiceCalculatedFieldInput,
  ModelServiceDependencies,
  ValidateCalculatedFieldResponse,
} from './modelServiceTypes';
import {
  getColumnByRuntimeIdentity,
  getModelByRuntimeIdentity,
} from './modelServiceRuntimeScopeSupport';

const logger = getLogger('ModelService');
logger.level = 'debug';

const generateReferenceNameFromDisplayName = (displayName: string) =>
  replaceAllowableSyntax(displayName);

export const validateCalculatedFieldNaming = async (
  deps: ModelServiceDependencies,
  displayName: string,
  modelId: number,
  columnId?: number,
): Promise<ValidateCalculatedFieldResponse> => {
  const validationRes = validateDisplayName(displayName);
  if (!validationRes.valid) {
    return {
      valid: false,
      message: validationRes.message || 'Invalid Calculated field name',
    };
  }

  const referenceName = generateReferenceNameFromDisplayName(displayName);
  let existedColumns = await deps.modelColumnRepository.findColumnsByModelIds([
    modelId,
  ]);
  if (columnId) {
    existedColumns = existedColumns.filter((column) => column.id !== columnId);
  }
  if (existedColumns.find((column) => column.referenceName === referenceName)) {
    return {
      valid: false,
      message: `The generated calculated field name "${referenceName}" is duplicated with existed column, please change the name and try again`,
    };
  }

  return { valid: true };
};

const getFieldDataType = async (
  deps: ModelServiceDependencies,
  fieldId: number,
): Promise<string> => {
  const field = await deps.modelColumnRepository.findOneBy({ id: fieldId });
  if (!field) {
    throw new Error('Field not found');
  }
  return field.type;
};

const inferCalculatedFieldDataType = async (
  deps: ModelServiceDependencies,
  expression: ExpressionName,
  inputFieldId: number,
) => {
  switch (expression) {
    case ExpressionName.CEIL:
    case ExpressionName.FLOOR:
    case ExpressionName.ROUND:
    case ExpressionName.SIGN:
    case ExpressionName.SUM:
    case ExpressionName.MAX:
    case ExpressionName.MIN:
    case ExpressionName.ABS:
      return getFieldDataType(deps, inputFieldId);
    case ExpressionName.CBRT:
    case ExpressionName.EXP:
    case ExpressionName.AVG:
    case ExpressionName.LN:
    case ExpressionName.LOG10:
      return 'DOUBLE';
    case ExpressionName.COUNT:
    case ExpressionName.LENGTH:
      return 'BIGINT';
    case ExpressionName.REVERSE:
      return 'VARBINARY';
    default:
      throw new Error('Unsupported expression');
  }
};

const checkCalculatedFieldCanQuery = async (
  deps: ModelServiceDependencies,
  modelId: number,
  modelName: string,
  data: ModelServiceCalculatedFieldInput,
) => {
  const model = await deps.modelRepository.findOneBy({ id: modelId });
  if (!model) {
    throw new Error('Model not found');
  }

  const runtimeIdentity = toPersistedRuntimeIdentityPatch(model);
  const { project, mdlBuilder } =
    await deps.mdlService.makeCurrentModelMDLByRuntimeIdentity(runtimeIdentity);
  const inputFieldId = data.lineage[data.lineage.length - 1];
  const dataType = await inferCalculatedFieldDataType(
    deps,
    data.expression,
    inputFieldId,
  );

  const modelColumn = {
    id: 99999999,
    modelId,
    displayName: data.referenceName,
    sourceColumnName: data.referenceName,
    referenceName: data.referenceName,
    type: dataType,
    isCalculated: true,
    isPk: false,
    notNull: false,
    aggregation: data.expression,
    lineage: JSON.stringify(data.lineage),
    properties: JSON.stringify({ description: '' }),
  } as ModelColumn;
  mdlBuilder.insertCalculatedField(modelName, modelColumn);
  const manifest = mdlBuilder.getManifest();
  const calculatedField = (manifest.models || [])
    .find((currentModel) => currentModel.name === modelName)
    ?.columns?.find((column) => column.name === data.referenceName);

  logger.debug(`Calculated field MDL: ${JSON.stringify(calculatedField)}`);

  if (project.type === DataSourceName.DUCKDB) {
    return deps.wrenEngineAdaptor.validateColumnIsValid(
      manifest,
      modelName,
      data.referenceName,
    );
  }

  return deps.queryService.validate(
    project,
    ValidationRules.COLUMN_IS_VALID,
    manifest,
    {
      modelName,
      columnName: data.referenceName,
    },
  );
};

const createCalculatedField = async (
  deps: ModelServiceDependencies,
  data: CreateCalculatedFieldData,
): Promise<ModelColumn> => {
  const { modelId, name: displayName, expression, lineage } = data;
  const logTitle = `Create Calculated Field ${displayName}`;
  const model = await deps.modelRepository.findOneBy({ id: modelId });
  if (!model) {
    throw new Error('Model not found');
  }

  const { valid, message } = await validateCalculatedFieldNaming(
    deps,
    displayName,
    modelId,
  );
  logger.debug(
    `${logTitle} : validateCalculatedFieldNaming: ${valid}, ${message}`,
  );
  if (!valid) {
    throw new Error(message);
  }

  const referenceName = generateReferenceNameFromDisplayName(displayName);
  logger.debug(`${logTitle} : generated referenceName: "${referenceName}"`);

  const { valid: canQuery, message: errorMessage } =
    await checkCalculatedFieldCanQuery(deps, modelId, model.referenceName, {
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

  const dataType = await inferCalculatedFieldDataType(
    deps,
    expression,
    lineage[lineage.length - 1],
  );
  logger.debug(`${logTitle} : inferCalculatedFieldDataType: ${dataType}`);

  return deps.modelColumnRepository.createOne({
    modelId,
    displayName,
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
};

export const createCalculatedFieldByRuntimeIdentity = async (
  deps: ModelServiceDependencies,
  runtimeIdentity: PersistedRuntimeIdentity,
  data: CreateCalculatedFieldData,
): Promise<ModelColumn> => {
  const model = await getModelByRuntimeIdentity(
    deps,
    runtimeIdentity,
    data.modelId,
  );
  if (!model) {
    throw new Error('Model not found');
  }

  return createCalculatedField(deps, data);
};

const updateCalculatedField = async (
  deps: ModelServiceDependencies,
  data: UpdateCalculatedFieldData,
  id: number,
): Promise<ModelColumn> => {
  const { name: displayName, expression, lineage } = data;
  const logTitle = `Update Calculated Field ${id}`;
  const column = await deps.modelColumnRepository.findOneBy({ id });
  if (!column) {
    throw new Error('Column not found');
  }
  const model = await deps.modelRepository.findOneBy({ id: column.modelId });
  if (!model) {
    throw new Error('Model not found');
  }

  const { valid, message } = await validateCalculatedFieldNaming(
    deps,
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

  const referenceName = generateReferenceNameFromDisplayName(displayName);
  logger.debug(`${logTitle}: generated referenceName: "${referenceName}"`);

  const { valid: canQuery, message: errorMessage } =
    await checkCalculatedFieldCanQuery(deps, model.id, model.referenceName, {
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

  const dataType = await inferCalculatedFieldDataType(
    deps,
    expression,
    lineage[lineage.length - 1],
  );
  logger.debug(`${logTitle}: inferCalculatedFieldDataType: ${dataType}`);

  return deps.modelColumnRepository.updateOne(id, {
    displayName,
    sourceColumnName: referenceName,
    referenceName,
    type: dataType,
    aggregation: expression,
    lineage: JSON.stringify(lineage),
  });
};

export const updateCalculatedFieldByRuntimeIdentity = async (
  deps: ModelServiceDependencies,
  runtimeIdentity: PersistedRuntimeIdentity,
  data: UpdateCalculatedFieldData,
  id: number,
): Promise<ModelColumn> => {
  const column = await getColumnByRuntimeIdentity(deps, runtimeIdentity, id);
  if (!column) {
    throw new Error('Column not found');
  }

  return updateCalculatedField(deps, data, id);
};
