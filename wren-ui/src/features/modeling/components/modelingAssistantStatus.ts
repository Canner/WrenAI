import type {
  DiagramModel,
  DiagramModelField,
  DiagramModelNestedField,
  DiagramModelRelationField,
  DiagramView,
  DiagramViewField,
} from '@/types/modeling';

export type ModelingAssistantTaskSummary = {
  key: 'semantics' | 'relationships';
  state: 'todo' | 'done';
  countLabel: string;
};

const hasDescription = (value?: string | null) =>
  typeof value === 'string' && value.trim().length > 0;

const fieldNeedsDescription = (
  field:
    | DiagramModelField
    | DiagramModelNestedField
    | DiagramViewField
    | null
    | undefined,
) => Boolean(field) && !hasDescription(field?.description);

const modelNeedsDescription = (model: DiagramModel | null | undefined) => {
  if (!model) {
    return false;
  }

  if (!hasDescription(model.description)) {
    return true;
  }

  return (model.fields || []).some((field) => fieldNeedsDescription(field));
};

const viewNeedsDescription = (view: DiagramView | null | undefined) => {
  if (!view) {
    return false;
  }

  if (!hasDescription(view.description)) {
    return true;
  }

  return (view.fields || []).some((field) => fieldNeedsDescription(field));
};

export const buildModelingAssistantTaskSummaries = ({
  models,
  views,
}: {
  models: Array<DiagramModel | null>;
  views?: Array<DiagramView | null>;
}): ModelingAssistantTaskSummary[] => {
  const relationCount = models.reduce(
    (total, model) =>
      total +
      (model?.relationFields || []).filter(
        (field): field is DiagramModelRelationField => Boolean(field),
      ).length,
    0,
  );
  const relationshipsState = relationCount > 0 ? 'done' : 'todo';
  const hasSemanticsGaps =
    models.some((model) => modelNeedsDescription(model)) ||
    (views || []).some((view) => viewNeedsDescription(view));

  return [
    {
      key: 'semantics',
      state: hasSemanticsGaps ? 'todo' : 'done',
      countLabel: '1',
    },
    {
      key: 'relationships',
      state: relationshipsState,
      countLabel: '1',
    },
  ];
};
