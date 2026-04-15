import { keyBy } from 'lodash';
import {
  ComposeDiagram,
  Diagram,
  DiagramModel,
  DiagramModelField,
  DiagramModelRelationField,
} from '@/utils/data/type';
import { getFieldValue } from '@/components/selectors/lineageSelector/FieldSelect';

type CalculatedFieldPayload = {
  diagramData: Diagram;
  data: ComposeDiagram & {
    modelId?: number;
    lineage?: number[];
    columnId?: number;
    displayName?: string;
    aggregation?: string;
  };
};

export const editCalculatedField = (
  payload: CalculatedFieldPayload,
  openCalculatedFieldModal: (defaultValue: any, payload: any) => void,
) => {
  const { diagramData, data } = payload;
  if (
    data.modelId === undefined ||
    data.columnId === undefined ||
    !data.displayName ||
    !data.aggregation ||
    !Array.isArray(data.lineage)
  ) {
    return;
  }
  const lineage = data.lineage;
  const models = (diagramData.models || []).filter(
    (model): model is DiagramModel => Boolean(model),
  );
  const sourceModel = models.find((model) => model.modelId === data.modelId);
  if (!sourceModel) {
    return;
  }

  const getField = (
    model: DiagramModel,
    columnId: number,
  ): DiagramModelField | undefined => {
    const fields = [
      ...(model.fields || []),
      ...(model.calculatedFields || []),
    ].filter((field): field is DiagramModelField => Boolean(field));
    return fields.find((field) => field.columnId === columnId);
  };

  // Retrieve from the source model directly if only one id in lineage
  const isSourceModelField = lineage.length === 1;
  if (isSourceModelField) {
    const field = getField(sourceModel, lineage[0]);
    if (!field) {
      return;
    }
    openCalculatedFieldModal &&
      openCalculatedFieldModal(
        {
          columnId: data.columnId,
          name: data.displayName,
          expression: data.aggregation,
          lineage: [getFieldValue(field)],
        },
        {
          models: diagramData.models,
          sourceModel,
        },
      );
    return;
  }

  // Otherwise, retrieve all relations and column by their id
  const allModelsMap: Record<string, DiagramModel> = keyBy(
    models,
    'referenceName',
  );
  const relationIds = [...lineage];
  const lastColumnId = relationIds.pop(); // it will also remove the last column id from relationIds

  let nextModel: DiagramModel | undefined = sourceModel;
  const relations: DiagramModelRelationField[] = [];
  for (const relationId of relationIds) {
    if (!nextModel) {
      break;
    }
    const relation: DiagramModelRelationField | undefined = (
      nextModel.relationFields || []
    )
      .filter((relationField): relationField is DiagramModelRelationField =>
        Boolean(relationField),
      )
      .find((relationField) => relationField.relationId === relationId);
    if (!relation) {
      break;
    }
    relations.push(relation);
    nextModel = allModelsMap[relation.referenceName];
  }

  const lastRelation = relations[relations.length - 1];
  const lastModel = lastRelation
    ? allModelsMap[lastRelation.referenceName]
    : sourceModel;
  if (!lastModel || lastColumnId === undefined) {
    return;
  }
  const field = getField(lastModel, lastColumnId);

  openCalculatedFieldModal &&
    openCalculatedFieldModal(
      {
        columnId: data.columnId,
        name: data.displayName,
        expression: data.aggregation,
        lineage: [...relations, field]
          .filter(
            (item): item is DiagramModelField | DiagramModelRelationField =>
              Boolean(item),
          )
          .map((item) => getFieldValue(item)),
      },
      {
        models,
        sourceModel,
      },
    );
};
