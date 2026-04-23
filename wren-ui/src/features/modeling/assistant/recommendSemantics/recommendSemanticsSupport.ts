import type { ModelListItem } from '@/hooks/useModelList';
import type {
  SemanticsDescriptionModel,
  SemanticsDescriptionSavePayload,
} from '@/types/modelingAssistant';

export const buildSemanticsDescriptionSavePayload = ({
  generatedModels,
  models,
}: {
  generatedModels: SemanticsDescriptionModel[];
  models: ModelListItem[];
}): SemanticsDescriptionSavePayload[] => {
  const modelMap = new Map(models.map((model) => [model.referenceName, model]));

  return generatedModels.reduce<SemanticsDescriptionSavePayload[]>(
    (acc, item) => {
      const model = modelMap.get(item.name);
      if (!model) {
        return acc;
      }

      const fieldMap = new Map(
        [...(model.fields || []), ...(model.calculatedFields || [])]
          .filter(
            (field): field is NonNullable<(typeof model.fields)[number]> =>
              Boolean(field),
          )
          .map((field) => [field.referenceName, field]),
      );
      const columnPayloads = item.columns
        .map((column) => {
          const field = fieldMap.get(column.name);
          if (!field) {
            return null;
          }
          return {
            id: field.id,
            description: column.description || '',
          };
        })
        .filter((column): column is { id: number; description: string } =>
          Boolean(column),
        );

      acc.push({
        modelId: model.id,
        data: {
          description: item.description || '',
          columns: columnPayloads,
        },
      });

      return acc;
    },
    [],
  );
};
