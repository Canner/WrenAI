import { COLUMN_TYPE, NODE_TYPE } from '@/utils/enum';
import { ERROR_TEXTS } from '@/utils/error';
import { stringFunctions } from '@/utils/expressionType';
import { ExpressionName } from '@/apollo/client/graphql/__types__';

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

export const checkStringFunctionAllowType = (
  expression: ExpressionName,
  value,
) => {
  const isField = [NODE_TYPE.FIELD, NODE_TYPE.CALCULATED_FIELD].includes(
    value.nodeType,
  );
  const allowTypes = [
    COLUMN_TYPE.VARCHAR,
    COLUMN_TYPE.CHAR,
    COLUMN_TYPE.TEXT,
    COLUMN_TYPE.STRING,
  ];

  // ignore if not a column or not a string function
  if (!isField || !stringFunctions.includes(expression)) {
    return true;
  }

  return allowTypes.includes(value.type.toLocaleUpperCase());
};

export const createLineageSelectorValidator =
  (expression: ExpressionName) =>
  (_rule: any, value: Record<string, any>[]) => {
    if (!value)
      return Promise.reject(
        new Error(ERROR_TEXTS.CALCULATED_FIELD.LINEAGE.REQUIRED),
      );

    const lastValue = value[value.length - 1];
    if (
      ![NODE_TYPE.FIELD, NODE_TYPE.CALCULATED_FIELD].includes(
        lastValue.nodeType,
      )
    ) {
      return Promise.reject(
        new Error(ERROR_TEXTS.CALCULATED_FIELD.LINEAGE.REQUIRED),
      );
    }

    if (!checkStringFunctionAllowType(expression, lastValue)) {
      return Promise.reject(
        new Error(ERROR_TEXTS.CALCULATED_FIELD.LINEAGE.INVALID_STRING_TYPE),
      );
    }

    return Promise.resolve();
  };
