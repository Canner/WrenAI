import { useEffect, useMemo, useState } from 'react';
import { message } from 'antd';
import {
  convertObjectToIdentifier,
  convertIdentifierToObject,
} from '@/utils/enum';
import { RelationsDataType } from '@/components/table/ModelRelationSelectionTable';
import { RelationFormValues } from '@/components/modals/RelationModal';
import useModelList from '@/hooks/useModelList';

interface Props {
  // The initial base model of model select
  model?: string;
  // The models to be excluded from model select
  excludeModels?: string[];
  enabled?: boolean;
}

// for identifier keys
const modelKeys = ['id', 'referenceName'];
const fieldKeys = ['id', 'referenceName'];

type RelationDefaultValue = {
  fromField: {
    modelId: string | number;
    modelName: string;
    fieldId: string | number;
    fieldName: string;
  };
  toField: {
    modelId: string | number;
    modelName: string;
    fieldId: string | number;
    fieldName: string;
  };
  type?: string;
};

export const convertFormValuesToIdentifier = (
  relationFormValues: RelationFormValues,
) => {
  const fromModel: { id: string; referenceName: string } =
    convertIdentifierToObject(relationFormValues.fromField.model);

  const fromField: { id: string; referenceName: string } =
    convertIdentifierToObject(relationFormValues.fromField.field);

  const toModel: { id: string; referenceName: string } =
    convertIdentifierToObject(relationFormValues.toField.model);

  const toField: { id: string; referenceName: string } =
    convertIdentifierToObject(relationFormValues.toField.field);

  return {
    ...relationFormValues,
    fromField: {
      modelId: fromModel.id,
      modelName: fromModel.referenceName,
      fieldId: fromField.id,
      fieldName: fromField.referenceName,
    },
    toField: {
      modelId: toModel.id,
      modelName: toModel.referenceName,
      fieldId: toField.id,
      fieldName: toField.referenceName,
    },
  } as RelationsDataType;
};

export const convertDefaultValueToIdentifier = (
  defaultValue: RelationDefaultValue,
) => {
  const fromField = {
    model: {
      id: defaultValue.fromField.modelId,
      referenceName: defaultValue.fromField.modelName,
    },
    field: {
      id: defaultValue.fromField.fieldId,
      referenceName: defaultValue.fromField.fieldName,
    },
  };
  const toField = {
    model: {
      id: defaultValue.toField.modelId,
      referenceName: defaultValue.toField.modelName,
    },
    field: {
      id: defaultValue.toField.fieldId,
      referenceName: defaultValue.toField.fieldName,
    },
  };
  return {
    fromField: {
      model: convertObjectToIdentifier(fromField.model, modelKeys),
      field: convertObjectToIdentifier(fromField.field, fieldKeys),
    },
    toField: {
      model: convertObjectToIdentifier(toField.model, modelKeys),
      field: convertObjectToIdentifier(toField.field, fieldKeys),
    },
    type: defaultValue.type,
  };
};

export default function useCombineFieldOptions(props: Props) {
  const { model, excludeModels, enabled = true } = props;

  const [baseModel, setBaseModel] = useState<string>(model ?? '');

  // bind model to baseModel
  useEffect(() => setBaseModel(model ?? ''), [model]);

  const { data } = useModelList({
    enabled,
    onError: (error) => {
      message.error(error.message || '加载模型列表失败，请稍后重试。');
    },
  });

  const allModels = useMemo(() => {
    if (!data) return [];

    return data.map((model) => ({
      id: model.id,
      referenceName: model.referenceName,
      displayName: model.displayName,
      fields: model.fields.filter(
        (field): field is NonNullable<(typeof model.fields)[number]> =>
          field != null,
      ),
    }));
  }, [data]);

  const filteredModels = useMemo(
    () =>
      allModels.filter(
        (item) =>
          !(excludeModels && excludeModels.includes(item.referenceName)),
      ),
    [allModels, excludeModels],
  );

  const modelOptions = useMemo(
    () =>
      filteredModels.map((model) => ({
        label: model.displayName,
        value: convertObjectToIdentifier(model, modelKeys),
        'data-testid': 'common__models__select-option',
      })),
    [filteredModels],
  );

  const selectedModel = useMemo(
    () => filteredModels.find((item) => item.referenceName === baseModel),
    [filteredModels, baseModel],
  );

  const fieldOptions = useMemo(
    () =>
      (selectedModel?.fields || []).map((field) => ({
        label: field.displayName,
        value: convertObjectToIdentifier(field, fieldKeys),
        'data-testid': 'common__fields__select-option',
      })),
    [selectedModel],
  );

  const onModelChange = (value: string) => {
    const model: { id: string; referenceName: string } =
      convertIdentifierToObject(value);
    setBaseModel(model.referenceName);
  };

  return { modelOptions, fieldOptions, onModelChange };
}
