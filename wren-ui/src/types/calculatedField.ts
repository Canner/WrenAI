export type CalculatedFieldValidationResponse = {
  message?: string | null;
  valid: boolean;
};

export type CalculatedFieldValidationResponsePayload = {
  validateCalculatedField: CalculatedFieldValidationResponse;
};

export type CreateCalculatedFieldInput = {
  expression: ExpressionName;
  lineage: number[];
  modelId: number;
  name: string;
};

export enum ExpressionName {
  ABS = 'ABS',
  AVG = 'AVG',
  CBRT = 'CBRT',
  CEIL = 'CEIL',
  CEILING = 'CEILING',
  COUNT = 'COUNT',
  COUNT_IF = 'COUNT_IF',
  EXP = 'EXP',
  FLOOR = 'FLOOR',
  LENGTH = 'LENGTH',
  LN = 'LN',
  LOG10 = 'LOG10',
  MAX = 'MAX',
  MIN = 'MIN',
  REVERSE = 'REVERSE',
  ROUND = 'ROUND',
  SIGN = 'SIGN',
  SUM = 'SUM',
}
