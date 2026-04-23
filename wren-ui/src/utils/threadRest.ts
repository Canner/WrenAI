import {
  buildRuntimeScopeUrl,
  type ClientRuntimeScopeSelector,
} from '@/runtime/client/runtimeScope';
import type {
  AdjustThreadResponseChartInput,
  CreateThreadResponseInput,
  ThreadResponse,
} from '@/types/home';

type ErrorPayload = {
  error?: string;
};

export const parseThreadRestResponse = async <TPayload>(
  response: Response,
  fallbackMessage: string,
): Promise<TPayload> => {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error((payload as ErrorPayload | null)?.error || fallbackMessage);
  }

  return payload as TPayload;
};

export const buildThreadResponsesCollectionUrl = (
  threadId: number,
  selector: ClientRuntimeScopeSelector,
) =>
  buildRuntimeScopeUrl(`/api/v1/threads/${threadId}/responses`, {}, selector);

export const buildThreadResponseItemUrl = (
  responseId: number,
  selector: ClientRuntimeScopeSelector,
) =>
  buildRuntimeScopeUrl(`/api/v1/thread-responses/${responseId}`, {}, selector);

export const buildGenerateThreadResponseAnswerUrl = (
  responseId: number,
  selector: ClientRuntimeScopeSelector,
) =>
  buildRuntimeScopeUrl(
    `/api/v1/thread-responses/${responseId}/generate-answer`,
    {},
    selector,
  );

export const buildThreadResponseAnswerStreamUrl = (
  responseId: number,
  selector: ClientRuntimeScopeSelector,
) =>
  buildRuntimeScopeUrl(
    `/api/v1/thread-responses/${responseId}/stream-answer`,
    {},
    selector,
  );

export const buildGenerateThreadResponseChartUrl = (
  responseId: number,
  selector: ClientRuntimeScopeSelector,
) =>
  buildRuntimeScopeUrl(
    `/api/v1/thread-responses/${responseId}/generate-chart`,
    {},
    selector,
  );

export const buildGenerateThreadResponseRecommendationsUrl = (
  responseId: number,
  selector: ClientRuntimeScopeSelector,
) =>
  buildRuntimeScopeUrl(
    `/api/v1/thread-responses/${responseId}/generate-recommendations`,
    {},
    selector,
  );

export const buildAdjustThreadResponseChartUrl = (
  responseId: number,
  selector: ClientRuntimeScopeSelector,
) =>
  buildRuntimeScopeUrl(
    `/api/v1/thread-responses/${responseId}/adjust-chart`,
    {},
    selector,
  );

export const buildThreadRecommendationQuestionsMutationUrl = (
  threadId: number,
  selector: ClientRuntimeScopeSelector,
) =>
  buildRuntimeScopeUrl(
    `/api/v1/thread-recommendation-questions/${threadId}`,
    {},
    selector,
  );

export const createThreadResponse = async (
  selector: ClientRuntimeScopeSelector,
  threadId: number,
  data: CreateThreadResponseInput,
) => {
  const response = await fetch(
    buildThreadResponsesCollectionUrl(threadId, selector),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    },
  );

  return parseThreadRestResponse<ThreadResponse>(
    response,
    '创建回答失败，请稍后重试',
  );
};

export const updateThreadResponseSql = async (
  selector: ClientRuntimeScopeSelector,
  responseId: number,
  data: { sql: string },
) => {
  const response = await fetch(
    buildThreadResponseItemUrl(responseId, selector),
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    },
  );

  return parseThreadRestResponse<ThreadResponse>(
    response,
    '更新 SQL 失败，请稍后重试',
  );
};

export const triggerThreadRecommendationQuestions = async (
  selector: ClientRuntimeScopeSelector,
  threadId: number,
) => {
  const response = await fetch(
    buildThreadRecommendationQuestionsMutationUrl(threadId, selector),
    {
      method: 'POST',
    },
  );

  return parseThreadRestResponse<{ success: boolean }>(
    response,
    '生成推荐追问失败，请稍后重试',
  );
};

export const triggerThreadResponseRecommendations = async (
  selector: ClientRuntimeScopeSelector,
  responseId: number,
  data?: { question?: string | null },
) => {
  const response = await fetch(
    buildGenerateThreadResponseRecommendationsUrl(responseId, selector),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data || {}),
    },
  );

  return parseThreadRestResponse<ThreadResponse>(
    response,
    '生成推荐追问失败，请稍后重试',
  );
};

export const triggerThreadResponseAnswer = async (
  selector: ClientRuntimeScopeSelector,
  responseId: number,
) => {
  const response = await fetch(
    buildGenerateThreadResponseAnswerUrl(responseId, selector),
    {
      method: 'POST',
    },
  );

  return parseThreadRestResponse<ThreadResponse>(
    response,
    '生成回答失败，请稍后重试',
  );
};

export const triggerThreadResponseChart = async (
  selector: ClientRuntimeScopeSelector,
  responseId: number,
) => {
  const response = await fetch(
    buildGenerateThreadResponseChartUrl(responseId, selector),
    {
      method: 'POST',
    },
  );

  return parseThreadRestResponse<ThreadResponse>(
    response,
    '生成图表失败，请稍后重试',
  );
};

export const adjustThreadResponseChart = async (
  selector: ClientRuntimeScopeSelector,
  responseId: number,
  data: AdjustThreadResponseChartInput,
) => {
  const response = await fetch(
    buildAdjustThreadResponseChartUrl(responseId, selector),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    },
  );

  return parseThreadRestResponse<ThreadResponse>(
    response,
    '调整图表失败，请稍后重试',
  );
};
