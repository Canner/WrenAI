import { ExpressionName } from '@/types/api';
import { JOIN_TYPE } from '@/utils/enum';

const DefaultText = '未知';

const joinTypeTextMap: Record<JOIN_TYPE, string> = {
  [JOIN_TYPE.MANY_TO_ONE]: '多对一',
  [JOIN_TYPE.ONE_TO_MANY]: '一对多',
  [JOIN_TYPE.ONE_TO_ONE]: '一对一',
};

type ExpressionText = {
  name: string;
  syntax: string;
  description: string;
};

const defaultExpressionText: ExpressionText = {
  name: DefaultText,
  syntax: DefaultText,
  description: DefaultText,
};

const expressionTextMap: Partial<Record<ExpressionName, ExpressionText>> = {
  // Aggregations
  [ExpressionName.AVG]: {
    name: 'Average',
    syntax: 'avg(column)',
    description: 'Returns the average of the values in the column.',
  },
  [ExpressionName.COUNT]: {
    name: 'Count',
    syntax: 'count(column)',
    description:
      'Returns the count of non-null rows (also known as records) in the selected data.',
  },
  [ExpressionName.MAX]: {
    name: 'Max',
    syntax: 'max(column)',
    description: 'Returns the largest value found in the column.',
  },
  [ExpressionName.MIN]: {
    name: 'Min',
    syntax: 'min(column)',
    description: 'Returns the smallest value found in the column.',
  },
  [ExpressionName.SUM]: {
    name: 'Sum',
    syntax: 'sum(column)',
    description: 'Adds up all the values of the column.',
  },

  // Math functions
  [ExpressionName.ABS]: {
    name: 'Absolute',
    syntax: 'abs(column)',
    description:
      'Returns the absolute (positive) value of the specified column.',
  },
  [ExpressionName.CBRT]: {
    name: 'Cube root',
    syntax: 'cbrt(column)',
    description: 'Returns the cube root of the number.',
  },
  [ExpressionName.CEIL]: {
    name: 'Ceil',
    syntax: 'ceil(column)',
    description: 'Rounds a decimal up (ceil as in ceiling).',
  },
  [ExpressionName.EXP]: {
    name: 'Exponential',
    syntax: 'exp(column)',
    description:
      'Returns Euler’s number, e, raised to the power of the supplied number.',
  },
  [ExpressionName.FLOOR]: {
    name: 'Floor',
    syntax: 'floor(column)',
    description: 'Rounds a decimal number down.',
  },
  [ExpressionName.LN]: {
    name: 'Natural logarithm',
    syntax: 'ln(column)',
    description: 'Returns the natural logarithm of the number.',
  },
  [ExpressionName.LOG10]: {
    name: 'Log10',
    syntax: 'log10(column)',
    description: 'Returns the base 10 log of the number.',
  },
  [ExpressionName.ROUND]: {
    name: 'Round',
    syntax: 'round(column)',
    description:
      'Rounds a decimal number either up or down to the nearest integer value.',
  },
  [ExpressionName.SIGN]: {
    name: 'Signum',
    syntax: 'sign(column)',
    description: 'Returns the signum function of the number.',
  },

  // String functions
  [ExpressionName.LENGTH]: {
    name: 'Length',
    syntax: 'length(column)',
    description: 'Returns the number of characters in string.',
  },
  [ExpressionName.REVERSE]: {
    name: 'Reverse',
    syntax: 'reverse(column)',
    description: 'Returns string with the characters in reverse order.',
  },
};

export const getJoinTypeText = (type?: JOIN_TYPE | string | null): string =>
  (type ? joinTypeTextMap[type as JOIN_TYPE] : undefined) || DefaultText;

export const getExpressionTexts = (
  type?: ExpressionName | null,
): ExpressionText =>
  (type ? expressionTextMap[type] : undefined) || defaultExpressionText;
