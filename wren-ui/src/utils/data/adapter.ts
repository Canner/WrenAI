import { Manifest } from '@/utils/data/type';
import { ModelData } from '@/utils/data/model';

export interface AdaptedData extends Omit<Manifest, 'models' | 'views'> {
  models: ModelData[];
}

export const adapter = (data: Manifest): AdaptedData => {
  const { models = [] } = data;
  const adaptModels = models.map((model) => {
    return new ModelData(model, data);
  });

  return {
    ...data,
    models: adaptModels,
  };
};
