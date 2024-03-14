import { Manifest } from '@/utils/data/type';
import {
  MetricData,
  ModelData,
  ViewData,
} from '@/utils/data/model';

export interface AdaptedData
  extends Omit<Manifest, 'models' | 'metrics' | 'views'> {
  models: ModelData[];
  metrics: MetricData[];
  views: ViewData[];
}

export const adapter = (data: Manifest): AdaptedData => {
  const {
    models = [],
    metrics = [],
    cumulativeMetrics = [],
    views = [],
  } = data;
  const adaptModels = models.map((model) => {
    return new ModelData(model, data);
  });
  const adaptMetrics = [...metrics, ...cumulativeMetrics].map((metric) => {
    // cumulative metric has window property
    return new MetricData(metric, !!metric.window);
  });

  const adaptViews = views.map((view) => {
    return new ViewData(view);
  });

  return {
    ...data,
    models: adaptModels,
    metrics: adaptMetrics,
    views: adaptViews,
  };
};
