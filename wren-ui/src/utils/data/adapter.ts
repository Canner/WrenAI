import { Manifest } from '@/utils/data/type';
import { ModelData, ViewData } from '@/utils/data/model';

export interface AdaptedData extends Omit<Manifest, 'models' | 'views'> {
  models: ModelData[];
  views: ViewData[];
}

export const adapter = (data: Manifest): AdaptedData => {
  const { models = [], views = [] } = data;
  const adaptModels = models.map((model) => {
    return new ModelData(model, data);
  });
  const adaptViews = views.map((view) => {
    return new ViewData(view);
  });

  return {
    ...data,
    models: adaptModels,
    views: adaptViews,
  };
};
