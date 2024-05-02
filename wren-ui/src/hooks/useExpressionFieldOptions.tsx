import { ExpressionName } from '@/apollo/client/graphql/__types__';
import { getExpressionTexts } from '@/utils/data';
import {
  aggregations,
  mathFunctions,
  stringFunctions,
} from '@/utils/expressionType';
import { useMemo } from 'react';

export default function useExpressionFieldOptions() {
  const expressionOptions = useMemo(() => {
    const convertor = (name: ExpressionName) => {
      const texts = getExpressionTexts(name);
      return {
        label: texts.name,
        value: name,
        content: {
          title: texts.syntax,
          description: texts.description,
          expression: texts.syntax,
        },
      };
    };

    return [
      {
        label: 'Aggregation',
        options: aggregations.map(convertor),
      },
      {
        label: 'Math functions',
        options: mathFunctions.map(convertor),
      },
      {
        label: 'String functions',
        options: stringFunctions.map(convertor),
      },
    ];
  }, []);

  return expressionOptions;
}
