import { useMemo } from 'react';

export default function useMetricDetailFormOptions() {
  const models = [
    { name: 'Model1', columns: [{ name: 'custKey', type: 'UUID' }] },
  ];

  const metrics = [
    { name: 'Metric1', columns: [{ name: 'custKey', type: 'UUID' }] },
  ];

  const modelMetricOptions = useMemo(() => {
    return [...models, ...metrics].map((item) => ({
      label: item.name,
      value: item.name,
    }));
  }, [models, metrics]);

  return {
    modelMetricOptions,
  };
}
