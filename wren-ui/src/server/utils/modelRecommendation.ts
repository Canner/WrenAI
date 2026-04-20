import { Manifest } from '@server/mdl/type';
import {
  RecommendationQuestion,
  RecommendationQuestionStatus,
  WrenAIError,
} from '@server/models/adaptor';

export type ModelRecommendationStatus =
  | 'NOT_STARTED'
  | RecommendationQuestionStatus;

export type ModelRecommendationState = {
  error: WrenAIError | null;
  queryId: string | null;
  questions: RecommendationQuestion[];
  status: ModelRecommendationStatus;
  updatedAt: string | null;
};

const parseJsonObject = (value?: string | null): Record<string, any> => {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const normalizeRecommendationQuestion = (
  value: unknown,
): RecommendationQuestion | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  if (typeof candidate.question !== 'string' || !candidate.question.trim()) {
    return null;
  }

  return {
    category:
      typeof candidate.category === 'string' ? candidate.category : '推荐问法',
    question: candidate.question,
    sql: typeof candidate.sql === 'string' ? candidate.sql : '',
  };
};

const normalizeRecommendationError = (value: unknown): WrenAIError | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  if (typeof candidate.message !== 'string' || !candidate.message.trim()) {
    return null;
  }

  return {
    code:
      typeof candidate.code === 'string' ? candidate.code : ('OTHERS' as any),
    message: candidate.message,
  };
};

export const createEmptyModelRecommendationState =
  (): ModelRecommendationState => ({
    error: null,
    queryId: null,
    questions: [],
    status: 'NOT_STARTED',
    updatedAt: null,
  });

export const normalizeModelRecommendationState = (
  value: unknown,
): ModelRecommendationState => {
  if (!value || typeof value !== 'object') {
    return createEmptyModelRecommendationState();
  }

  const candidate = value as Record<string, unknown>;
  const status =
    candidate.status === RecommendationQuestionStatus.GENERATING ||
    candidate.status === RecommendationQuestionStatus.FINISHED ||
    candidate.status === RecommendationQuestionStatus.FAILED ||
    candidate.status === 'NOT_STARTED'
      ? candidate.status
      : 'NOT_STARTED';

  return {
    error: normalizeRecommendationError(candidate.error),
    queryId: typeof candidate.queryId === 'string' ? candidate.queryId : null,
    questions: Array.isArray(candidate.questions)
      ? candidate.questions
          .map(normalizeRecommendationQuestion)
          .filter(
            (question): question is RecommendationQuestion => Boolean(question),
          )
      : [],
    status,
    updatedAt:
      typeof candidate.updatedAt === 'string' ? candidate.updatedAt : null,
  };
};

export const readModelRecommendationState = (
  properties?: string | null,
): ModelRecommendationState =>
  normalizeModelRecommendationState(parseJsonObject(properties).aiRecommendations);

export const mergeModelRecommendationState = ({
  properties,
  recommendation,
}: {
  properties?: string | null;
  recommendation: ModelRecommendationState;
}) => {
  const nextProperties = parseJsonObject(properties);
  nextProperties.aiRecommendations = {
    error: recommendation.error,
    queryId: recommendation.queryId,
    questions: recommendation.questions,
    status: recommendation.status,
    updatedAt: recommendation.updatedAt,
  };
  return JSON.stringify(nextProperties);
};

export const buildRecommendationManifestForModel = ({
  manifest,
  modelName,
}: {
  manifest: Manifest;
  modelName: string;
}): Manifest => {
  const models = (manifest.models || []).filter(
    (model) => model?.name === modelName,
  );

  if (!models.length) {
    throw new Error(`Model ${modelName} not found in deployed manifest`);
  }

  const selectedModels = new Set(
    models.map((model) => model?.name).filter(Boolean) as string[],
  );

  return {
    ...manifest,
    models,
    relationships: (manifest.relationships || []).filter((relationship) => {
      const relationModels = relationship?.models || [];
      return (
        relationModels.length > 0 &&
        relationModels.every((name) => selectedModels.has(name))
      );
    }),
    views: [],
  };
};
