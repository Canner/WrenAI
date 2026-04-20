import { getConfig } from '@server/config';
import { RecommendationQuestionStatus } from '@server/models/adaptor';
import { Model } from '@server/repositories';
import { IContext } from '@server/types';
import { resolveProjectLanguage } from '@server/utils/runtimeExecutionContext';
import { toAskRuntimeIdentity } from '@server/services/askingServiceRuntimeSupport';
import {
  buildRecommendationManifestForModel,
  createEmptyModelRecommendationState,
  mergeModelRecommendationState,
  ModelRecommendationState,
  readModelRecommendationState,
} from '@server/utils/modelRecommendation';

const config = getConfig();

interface ModelControllerRecommendationDeps {
  assertExecutableRuntimeScope: (
    ctx: IContext,
    runtimeScope?: IContext['runtimeScope'],
  ) => Promise<void>;
  assertKnowledgeBaseReadAccess: (
    ctx: IContext,
    runtimeScope?: IContext['runtimeScope'],
  ) => Promise<void>;
  assertKnowledgeBaseWriteAccess: (ctx: IContext) => Promise<void>;
  ensureModelScope: (
    ctx: IContext,
    modelId: number,
    errorMessage?: string,
  ) => Promise<Model>;
  getResponseExecutionContext: (
    ctx: IContext,
    source?: Record<string, any> | null,
  ) => Promise<{
    runtimeIdentity: Record<string, any>;
    project: { language?: string | null };
    manifest: any;
  }>;
  recordKnowledgeBaseReadAudit: (
    ctx: IContext,
    args: {
      runtimeScope?: IContext['runtimeScope'];
      resourceType?: string | null;
      resourceId?: string | number | null;
      payloadJson?: Record<string, any> | null;
    },
  ) => Promise<void>;
  recordKnowledgeBaseWriteAudit: (
    ctx: IContext,
    args: {
      resourceType: string;
      resourceId?: string | number | null;
      afterJson?: Record<string, any> | null;
      payloadJson?: Record<string, any> | null;
    },
  ) => Promise<void>;
}

const buildRecommendationState = (
  recommendation: Partial<ModelRecommendationState>,
): ModelRecommendationState => ({
  ...createEmptyModelRecommendationState(),
  ...recommendation,
  error: recommendation.error || null,
  queryId: recommendation.queryId || null,
  questions: recommendation.questions || [],
  updatedAt: recommendation.updatedAt || null,
});

const persistModelRecommendation = async ({
  ctx,
  model,
  recommendation,
}: {
  ctx: IContext;
  model: Model;
  recommendation: ModelRecommendationState;
}) => {
  const properties = mergeModelRecommendationState({
    properties: model.properties,
    recommendation,
  });
  await ctx.modelRepository.updateOne(model.id, { properties });
  return {
    ...model,
    properties,
  };
};

const buildRecommendationConfig = ({
  ctx,
  project,
}: {
  ctx: IContext;
  project: { language?: string | null };
}) => ({
  configuration: {
    language: resolveProjectLanguage(
      project as any,
      ctx.runtimeScope?.knowledgeBase,
    ),
  },
  maxCategories: config.projectRecommendationQuestionMaxCategories,
  maxQuestions: config.projectRecommendationQuestionsMaxQuestions,
  regenerate: true,
});

export const generateModelRecommendationQuestionsAction = async ({
  modelId,
  ctx,
  deps,
}: {
  modelId: number;
  ctx: IContext;
  deps: ModelControllerRecommendationDeps;
}) => {
  await deps.assertExecutableRuntimeScope(ctx);
  await deps.assertKnowledgeBaseWriteAccess(ctx);

  const model = await deps.ensureModelScope(ctx, modelId);
  const currentRecommendation = readModelRecommendationState(model.properties);

  if (
    currentRecommendation.status === 'GENERATING' &&
    currentRecommendation.queryId
  ) {
    return currentRecommendation;
  }

  if (currentRecommendation.status === 'FINISHED') {
    return currentRecommendation;
  }

  const executionContext = await deps.getResponseExecutionContext(ctx);
  const manifest = buildRecommendationManifestForModel({
    manifest: executionContext.manifest,
    modelName: model.referenceName,
  });
  const response = await ctx.wrenAIAdaptor.generateRecommendationQuestions({
    manifest,
    runtimeScopeId: ctx.runtimeScope?.selector?.runtimeScopeId || undefined,
    runtimeIdentity: toAskRuntimeIdentity(
      executionContext.runtimeIdentity as any,
    ),
    previousQuestions: [],
    ...buildRecommendationConfig({
      ctx,
      project: executionContext.project,
    }),
  });

  const recommendation = buildRecommendationState({
    error: null,
    queryId: response.queryId,
    questions: currentRecommendation.questions,
    status: RecommendationQuestionStatus.GENERATING,
    updatedAt: new Date().toISOString(),
  });

  await persistModelRecommendation({
    ctx,
    model,
    recommendation,
  });
  await deps.recordKnowledgeBaseWriteAudit(ctx, {
    resourceType: 'model',
    resourceId: model.id,
    payloadJson: {
      operation: 'generate_model_recommendation_questions',
      queryId: response.queryId,
    },
  });

  return recommendation;
};

export const getModelRecommendationQuestionsAction = async ({
  modelId,
  ctx,
  deps,
}: {
  modelId: number;
  ctx: IContext;
  deps: ModelControllerRecommendationDeps;
}) => {
  await deps.assertExecutableRuntimeScope(ctx);
  await deps.assertKnowledgeBaseReadAccess(ctx);

  let model = await deps.ensureModelScope(ctx, modelId);
  let recommendation = readModelRecommendationState(model.properties);

  if (recommendation.status === 'GENERATING' && recommendation.queryId) {
    const result = await ctx.wrenAIAdaptor.getRecommendationQuestionsResult(
      recommendation.queryId,
    );
    const nextRecommendation = buildRecommendationState({
      error: result.error || null,
      queryId: recommendation.queryId,
      questions: result.response?.questions || recommendation.questions,
      status: result.status,
      updatedAt: new Date().toISOString(),
    });

    const hasChanged =
      nextRecommendation.status !== recommendation.status ||
      nextRecommendation.questions.length !== recommendation.questions.length ||
      nextRecommendation.error?.message !== recommendation.error?.message;

    if (hasChanged) {
      model = await persistModelRecommendation({
        ctx,
        model,
        recommendation: nextRecommendation,
      });
      recommendation = readModelRecommendationState(model.properties);
    } else {
      recommendation = nextRecommendation;
    }
  }

  await deps.recordKnowledgeBaseReadAudit(ctx, {
    resourceType: 'model',
    resourceId: model.id,
    payloadJson: {
      operation: 'get_model_recommendation_questions',
    },
  });

  return recommendation;
};
