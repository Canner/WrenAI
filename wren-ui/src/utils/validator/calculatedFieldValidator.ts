import { NODE_TYPE } from '@/utils/enum';
import { ERROR_TEXTS } from '@/utils/error';

export const createLineageSelectorNameValidator =
  (validateCalculatedField: any) => async (_rule: any, value: string) => {
    if (!value) {
      return Promise.reject(ERROR_TEXTS.CALCULATED_FIELD.NAME.REQUIRED);
    }

    const result = await validateCalculatedField(value);

    const { valid, message } = result?.data?.validateCalculatedField;

    if (!valid) {
      return Promise.reject(message);
    }

    return Promise.resolve();
  };

export const lineageSelectorValidator = (
  _rule: any,
  value: Record<string, any>[],
) => {
  if (!value)
    return Promise.reject(
      new Error(ERROR_TEXTS.CALCULATED_FIELD.LINEAGE.REQUIRED),
    );

  const lastValue = value[value.length - 1];
  if (
    ![NODE_TYPE.FIELD, NODE_TYPE.CALCULATED_FIELD].includes(lastValue.nodeType)
  ) {
    return Promise.reject(
      new Error(ERROR_TEXTS.CALCULATED_FIELD.LINEAGE.REQUIRED),
    );
  }

  return Promise.resolve();
};
