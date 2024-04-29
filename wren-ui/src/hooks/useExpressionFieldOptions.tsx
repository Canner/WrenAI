import { useMemo } from 'react';

export default function useExpressionFieldOptions() {
  const expressionOptions = useMemo(() => {
    return [
      {
        label: 'Aggregation',
        options: [
          {
            label: 'Sum',
            value: 'sum',
            content: {
              title: 'Sum(column)',
              description: 'Adds up all the value of the column.',
              expression: 'Sum([order.price])',
            },
          },
          {
            label: 'Average',
            value: 'average',
            content: {
              title: 'Average(column)',
              description: 'Adds up all the value of the column.',
              expression: 'Average([order.price])',
            },
          },
          {
            label: 'Count',
            value: 'count',
            content: {
              title: 'Count(column)',
              description: 'Adds up all the value of the column.',
              expression: 'count([order.price])',
            },
          },
        ],
      },
    ];
  }, []);

  return expressionOptions;
}
