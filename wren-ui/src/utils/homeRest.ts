import {
  buildRuntimeScopeUrl,
  resolveClientRuntimeScopeSelector,
  type ClientRuntimeScopeSelector,
} from '@/apollo/client/runtimeScope';
import type {
  AskingTask,
  AskingTaskInput,
  CreateDashboardItemInput,
  CreateThreadInput,
  Task,
  Thread,
  ThreadResponse,
} from '@/apollo/client/graphql/__types__';
import type {
  GetProjectRecommendationQuestionsQuery,
  InstantRecommendedQuestionsQuery,
  PreviewDataMutation,
  SuggestedQuestionsQuery,
} from '@/apollo/client/graphql/home.generated';
import { parseRestJsonResponse } from './rest';

type AdjustThreadResponseAnswerInput = {
  tables?: string[];
  sqlGenerationReasoning?: string;
  sql?: string;
};

type PreviewDataPayload = PreviewDataMutation['previewData'];
type SuggestedQuestionsPayload = SuggestedQuestionsQuery['suggestedQuestions'];
type ProjectRecommendationQuestionsPayload =
  GetProjectRecommendationQuestionsQuery['getProjectRecommendationQuestions'];
type InstantRecommendedQuestionsPayload =
  InstantRecommendedQuestionsQuery['instantRecommendedQuestions'];

export const buildSuggestedQuestionsUrl = (
  selector = resolveClientRuntimeScopeSelector(),
) => buildRuntimeScopeUrl('/api/v1/suggested-questions', {}, selector);

export const buildProjectRecommendationQuestionsUrl = (
  selector = resolveClientRuntimeScopeSelector(),
) =>
  buildRuntimeScopeUrl(
    '/api/v1/project-recommendation-questions',
    {},
    selector,
  );

export const buildThreadsUrl = (
  selector = resolveClientRuntimeScopeSelector(),
) => buildRuntimeScopeUrl('/api/v1/threads', {}, selector);

export const buildAskingTasksUrl = (
  selector = resolveClientRuntimeScopeSelector(),
) => buildRuntimeScopeUrl('/api/v1/asking-tasks', {}, selector);

export const buildAskingTaskUrl = (
  taskId: string,
  selector = resolveClientRuntimeScopeSelector(),
) => buildRuntimeScopeUrl(`/api/v1/asking-tasks/${taskId}`, {}, selector);

export const buildAskingTaskCancelUrl = (
  taskId: string,
  selector = resolveClientRuntimeScopeSelector(),
) =>
  buildRuntimeScopeUrl(`/api/v1/asking-tasks/${taskId}/cancel`, {}, selector);

export const buildInstantRecommendedQuestionsCollectionUrl = (
  selector = resolveClientRuntimeScopeSelector(),
) =>
  buildRuntimeScopeUrl('/api/v1/instant-recommended-questions', {}, selector);

export const buildInstantRecommendedQuestionsTaskUrl = (
  taskId: string,
  selector = resolveClientRuntimeScopeSelector(),
) =>
  buildRuntimeScopeUrl(
    `/api/v1/instant-recommended-questions/${taskId}`,
    {},
    selector,
  );

export const buildThreadResponsePreviewDataUrl = (
  responseId: number,
  selector = resolveClientRuntimeScopeSelector(),
) =>
  buildRuntimeScopeUrl(
    `/api/v1/thread-responses/${responseId}/preview-data`,
    {},
    selector,
  );

export const buildThreadResponseNativeSqlUrl = (
  responseId: number,
  selector = resolveClientRuntimeScopeSelector(),
) =>
  buildRuntimeScopeUrl(
    `/api/v1/thread-responses/${responseId}/native-sql`,
    {},
    selector,
  );

export const buildThreadResponseAdjustAnswerUrl = (
  responseId: number,
  selector = resolveClientRuntimeScopeSelector(),
) =>
  buildRuntimeScopeUrl(
    `/api/v1/thread-responses/${responseId}/adjust-answer`,
    {},
    selector,
  );

export const buildThreadResponseRerunAskingTaskUrl = (
  responseId: number,
  selector = resolveClientRuntimeScopeSelector(),
) =>
  buildRuntimeScopeUrl(
    `/api/v1/thread-responses/${responseId}/rerun-asking-task`,
    {},
    selector,
  );

export const buildThreadResponseRerunAdjustmentUrl = (
  responseId: number,
  selector = resolveClientRuntimeScopeSelector(),
) =>
  buildRuntimeScopeUrl(
    `/api/v1/thread-responses/${responseId}/rerun-adjustment`,
    {},
    selector,
  );

export const buildAdjustmentTaskCancelUrl = (
  taskId: string,
  selector = resolveClientRuntimeScopeSelector(),
) =>
  buildRuntimeScopeUrl(
    `/api/v1/adjustment-tasks/${taskId}/cancel`,
    {},
    selector,
  );

export const buildDashboardItemsUrl = (
  selector = resolveClientRuntimeScopeSelector(),
) => buildRuntimeScopeUrl('/api/v1/dashboard-items', {}, selector);

export const fetchSuggestedQuestions = async (
  selector: ClientRuntimeScopeSelector = resolveClientRuntimeScopeSelector(),
) => {
  const response = await fetch(buildSuggestedQuestionsUrl(selector));
  return parseRestJsonResponse<SuggestedQuestionsPayload>(
    response,
    '加载推荐问题失败，请稍后重试。',
  );
};

export const getProjectRecommendationQuestions = async (
  selector: ClientRuntimeScopeSelector = resolveClientRuntimeScopeSelector(),
) => {
  const response = await fetch(
    buildProjectRecommendationQuestionsUrl(selector),
  );
  return parseRestJsonResponse<ProjectRecommendationQuestionsPayload>(
    response,
    '加载项目推荐问题失败，请稍后重试。',
  );
};

export const generateProjectRecommendationQuestions = async (
  selector: ClientRuntimeScopeSelector = resolveClientRuntimeScopeSelector(),
) => {
  const response = await fetch(
    buildProjectRecommendationQuestionsUrl(selector),
    {
      method: 'POST',
    },
  );
  return parseRestJsonResponse<{ success: boolean }>(
    response,
    '生成项目推荐问题失败，请稍后重试。',
  );
};

export const createThread = async (
  selector: ClientRuntimeScopeSelector,
  data: CreateThreadInput,
) => {
  const response = await fetch(buildThreadsUrl(selector), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return parseRestJsonResponse<Thread>(response, '创建对话失败，请稍后重试。');
};

export const createAskingTask = async (
  selector: ClientRuntimeScopeSelector,
  data: AskingTaskInput,
) => {
  const response = await fetch(buildAskingTasksUrl(selector), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return parseRestJsonResponse<Task>(
    response,
    '创建问答任务失败，请稍后重试。',
  );
};

export const getAskingTask = async (
  selector: ClientRuntimeScopeSelector,
  taskId: string,
) => {
  const response = await fetch(buildAskingTaskUrl(taskId, selector), {
    cache: 'no-store',
  });
  return parseRestJsonResponse<AskingTask | null>(
    response,
    '加载问答任务失败，请稍后重试。',
  );
};

export const cancelAskingTask = async (
  selector: ClientRuntimeScopeSelector,
  taskId: string,
) => {
  const response = await fetch(buildAskingTaskCancelUrl(taskId, selector), {
    method: 'POST',
  });
  return parseRestJsonResponse<{ success: boolean }>(
    response,
    '停止问答任务失败，请稍后重试。',
  );
};

export const createInstantRecommendedQuestions = async (
  selector: ClientRuntimeScopeSelector,
  data: { previousQuestions?: string[] },
) => {
  const response = await fetch(
    buildInstantRecommendedQuestionsCollectionUrl(selector),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    },
  );
  return parseRestJsonResponse<Task>(
    response,
    '生成推荐问题失败，请稍后重试。',
  );
};

export const getInstantRecommendedQuestions = async (
  selector: ClientRuntimeScopeSelector,
  taskId: string,
) => {
  const response = await fetch(
    buildInstantRecommendedQuestionsTaskUrl(taskId, selector),
    {
      cache: 'no-store',
    },
  );
  return parseRestJsonResponse<InstantRecommendedQuestionsPayload>(
    response,
    '加载推荐问题失败，请稍后重试。',
  );
};

export const getThreadResponsePreviewData = async (
  selector: ClientRuntimeScopeSelector,
  responseId: number,
) => {
  const response = await fetch(
    buildThreadResponsePreviewDataUrl(responseId, selector),
    {
      cache: 'no-store',
    },
  );
  return parseRestJsonResponse<PreviewDataPayload>(
    response,
    '加载预览数据失败，请稍后重试。',
  );
};

export const getThreadResponseNativeSql = async (
  selector: ClientRuntimeScopeSelector,
  responseId: number,
) => {
  const response = await fetch(
    buildThreadResponseNativeSqlUrl(responseId, selector),
    {
      cache: 'no-store',
    },
  );
  return parseRestJsonResponse<string>(
    response,
    '加载原生 SQL 失败，请稍后重试。',
  );
};

export const adjustThreadResponseAnswer = async (
  selector: ClientRuntimeScopeSelector,
  responseId: number,
  data: AdjustThreadResponseAnswerInput,
) => {
  const response = await fetch(
    buildThreadResponseAdjustAnswerUrl(responseId, selector),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    },
  );
  return parseRestJsonResponse<ThreadResponse>(
    response,
    '调整回答失败，请稍后重试。',
  );
};

export const rerunAskingTask = async (
  selector: ClientRuntimeScopeSelector,
  responseId: number,
) => {
  const response = await fetch(
    buildThreadResponseRerunAskingTaskUrl(responseId, selector),
    {
      method: 'POST',
    },
  );
  return parseRestJsonResponse<Task>(
    response,
    '重新执行问答任务失败，请稍后重试。',
  );
};

export const cancelAdjustmentTask = async (
  selector: ClientRuntimeScopeSelector,
  taskId: string,
) => {
  const response = await fetch(buildAdjustmentTaskCancelUrl(taskId, selector), {
    method: 'POST',
  });
  return parseRestJsonResponse<{ success: boolean }>(
    response,
    '停止调整任务失败，请稍后重试。',
  );
};

export const rerunAdjustmentTask = async (
  selector: ClientRuntimeScopeSelector,
  responseId: number,
) => {
  const response = await fetch(
    buildThreadResponseRerunAdjustmentUrl(responseId, selector),
    {
      method: 'POST',
    },
  );
  return parseRestJsonResponse<{ success: boolean }>(
    response,
    '重试调整任务失败，请稍后重试。',
  );
};

export const createDashboardItem = async (
  selector: ClientRuntimeScopeSelector,
  data: CreateDashboardItemInput,
) => {
  const response = await fetch(buildDashboardItemsUrl(selector), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return parseRestJsonResponse<{
    id: number;
    dashboardId: number;
  }>(response, '固定到看板失败，请稍后重试。');
};

export type {
  PreviewDataPayload,
  SuggestedQuestionsPayload,
  ProjectRecommendationQuestionsPayload,
  InstantRecommendedQuestionsPayload,
  AdjustThreadResponseAnswerInput,
};
