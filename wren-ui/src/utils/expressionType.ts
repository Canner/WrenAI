import { ExpressionName } from '@/apollo/client/graphql/__types__';

export const aggregations = [
  ExpressionName.AVG,
  ExpressionName.COUNT,
  ExpressionName.MAX,
  ExpressionName.MIN,
  ExpressionName.SUM,
];

export const mathFunctions = [
  ExpressionName.ABS,
  ExpressionName.CBRT,
  ExpressionName.CEIL,
  ExpressionName.EXP,
  ExpressionName.FLOOR,
  ExpressionName.LN,
  ExpressionName.LOG10,
  ExpressionName.ROUND,
  ExpressionName.SIGN,
];

export const stringFunctions = [ExpressionName.LENGTH, ExpressionName.REVERSE];
