import { COLUMN_TYPE, NODE_TYPE } from '@/utils/enum';
import { ERROR_TEXTS } from '@/utils/error';
import { mathFunctions, stringFunctions } from '@/utils/expressionType';
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

const makeCheckAllowType =
  (functions: ExpressionName[], allowTypes: COLUMN_TYPE[]) =>
  (expression: ExpressionName, value) => {
    const isField = [NODE_TYPE.FIELD, NODE_TYPE.CALCULATED_FIELD].includes(
      value.nodeType,
    );

    // ignore if not a column or not a string function
    if (!isField || !functions.includes(expression)) {
      return true;
    }

    return allowTypes.includes(value.type.toLocaleUpperCase());
  };

export const checkStringFunctionAllowType = makeCheckAllowType(
  stringFunctions,
  [
    COLUMN_TYPE.VARCHAR,
    COLUMN_TYPE.CHAR,
    COLUMN_TYPE.BPCHAR,
    COLUMN_TYPE.TEXT,
    COLUMN_TYPE.STRING,
    COLUMN_TYPE.NAME,
  ],
);

export const checkNumberFunctionAllowType = makeCheckAllowType(mathFunctions, [
  COLUMN_TYPE.TINYINT,
  COLUMN_TYPE.INT2,
  COLUMN_TYPE.SMALLINT,
  COLUMN_TYPE.INT4,
  COLUMN_TYPE.INTEGER,
  COLUMN_TYPE.INT8,
  COLUMN_TYPE.BIGINT,
  COLUMN_TYPE.INT64,
  COLUMN_TYPE.NUMERIC,
  COLUMN_TYPE.DECIMAL,
  COLUMN_TYPE.FLOAT4,
  COLUMN_TYPE.REAL,
  COLUMN_TYPE.FLOAT8,
  COLUMN_TYPE.DOUBLE,
]);

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

    if (!checkNumberFunctionAllowType(expression, lastValue)) {
      return Promise.reject(
        new Error(ERROR_TEXTS.CALCULATED_FIELD.LINEAGE.INVALID_NUMBER_TYPE),
      );
    }

    return Promise.resolve();
  };
