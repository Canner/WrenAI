import type { ThreadResponse } from '@/types/home';
import type {
  ComposerDraftIntent,
  HomeIntentEnvelope,
  ResolvedHomeIntent,
} from '@/types/homeIntent';
import {
  hasResponseSqlArtifact,
  resolveFallbackWorkbenchArtifact,
} from './threadWorkbenchState';
import {
  resolveDefaultArtifactPlanForIntent,
  resolveResponseHomeIntent,
} from './homeIntentContract';

export type HomeComposerIntent = {
  envelope: HomeIntentEnvelope;
  resolvedIntent: ResolvedHomeIntent;
  sourceResponseId?: number | null;
};

const CHART_ONLY_PATTERNS = [
  /(生成|做成|画|绘制|转成|换成).{0,8}(图|图表|柱状图|折线图|饼图|面积图)/i,
  /(chart|plot|graph|visuali[sz]e)/i,
  /(给我).{0,4}(一张|一个).{0,4}(图|图表)/i,
  /(结果|数据|这个|这条|上面|当前).{0,8}(画|做成|生成).{0,8}(图|图表)/i,
];

const RECOMMEND_QUESTION_PATTERNS = [
  /(推荐|建议).{0,4}(几个|一些)?(问题|追问)/i,
  /(再|继续).{0,6}(推荐|建议).{0,4}(问题|追问)/i,
  /(recommend|suggest).{0,12}(question|follow[- ]?up)/i,
];

const normalizeComposerQuestion = (question: string) =>
  question.trim().toLowerCase().replace(/\s+/g, '');

const countSharedPrefix = (left: string, right: string) => {
  const sharedLength = Math.min(left.length, right.length);
  let index = 0;
  while (index < sharedLength && left[index] === right[index]) {
    index += 1;
  }
  return index;
};

export const isChartOnlyComposerQuestion = (question: string) => {
  const normalized = question.trim();
  if (!normalized || normalized.length > 40) {
    return false;
  }

  return CHART_ONLY_PATTERNS.some((pattern) => pattern.test(normalized));
};

export const isRecommendOnlyComposerQuestion = (question: string) => {
  const normalized = question.trim();
  if (!normalized || normalized.length > 40) {
    return false;
  }

  return RECOMMEND_QUESTION_PATTERNS.some((pattern) =>
    pattern.test(normalized),
  );
};

export const shouldApplyComposerDraftIntent = ({
  draftIntent,
  question,
}: {
  draftIntent?: ComposerDraftIntent | null;
  question: string;
}) => {
  if (!draftIntent) {
    return false;
  }

  const normalizedQuestion = normalizeComposerQuestion(question);
  const normalizedDraft = normalizeComposerQuestion(draftIntent.draftedPrompt);
  if (!normalizedQuestion || !normalizedDraft) {
    return false;
  }

  if (normalizedQuestion === normalizedDraft) {
    return true;
  }

  if (
    normalizedQuestion.includes(normalizedDraft) ||
    normalizedDraft.includes(normalizedQuestion)
  ) {
    return true;
  }

  const sharedPrefix = countSharedPrefix(normalizedQuestion, normalizedDraft);
  return (
    sharedPrefix /
      Math.max(normalizedDraft.length, normalizedQuestion.length) >=
    0.6
  );
};

const resolveResponseSourceId = (response: ThreadResponse) => {
  const resolvedIntent = resolveResponseHomeIntent(response);
  if (resolvedIntent?.kind === 'CHART') {
    return (
      response.artifactLineage?.sourceResponseId ??
      response.sourceResponseId ??
      response.id
    );
  }

  return response.id;
};

const buildAskComposerIntent = ({
  responses,
  selectedResponse,
}: {
  responses: ThreadResponse[];
  selectedResponse?: ThreadResponse | null;
}): HomeComposerIntent => {
  const sourceThreadId =
    selectedResponse?.threadId ??
    responses[responses.length - 1]?.threadId ??
    null;

  return {
    envelope: {
      entrypoint: 'composer',
      intentHint: 'ASK',
      sourceThreadId,
      sourceResponseId: selectedResponse?.id ?? null,
      sourceWorkbenchArtifacts:
        selectedResponse?.resolvedIntent?.artifactPlan?.workbenchArtifacts ||
        null,
      preferredWorkbenchArtifact: 'preview',
    },
    resolvedIntent: {
      kind: 'ASK',
      mode: responses.length > 0 ? 'FOLLOW_UP' : 'NEW',
      target: 'THREAD_RESPONSE',
      source: 'derived',
      sourceThreadId,
      sourceResponseId: selectedResponse?.id ?? null,
      confidence: null,
      artifactPlan: resolveDefaultArtifactPlanForIntent('ASK'),
      conversationAidPlan: null,
    },
    sourceResponseId: selectedResponse?.id ?? null,
  };
};

const buildRecommendComposerIntent = ({
  responses,
  selectedResponse,
  sourceResponseId,
}: {
  responses: ThreadResponse[];
  selectedResponse?: ThreadResponse | null;
  sourceResponseId?: number | null;
}): HomeComposerIntent => {
  const fallbackThreadId =
    selectedResponse?.threadId ??
    responses[responses.length - 1]?.threadId ??
    null;
  const resolvedSourceResponseId =
    sourceResponseId ?? selectedResponse?.id ?? null;

  return {
    envelope: {
      entrypoint: 'composer',
      intentHint: 'RECOMMEND_QUESTIONS',
      sourceThreadId: fallbackThreadId,
      sourceResponseId: resolvedSourceResponseId,
      sourceWorkbenchArtifacts:
        selectedResponse?.resolvedIntent?.artifactPlan?.workbenchArtifacts ||
        null,
      preferredWorkbenchArtifact:
        selectedResponse?.resolvedIntent?.artifactPlan
          ?.primaryWorkbenchArtifact ?? null,
    },
    resolvedIntent: {
      kind: 'RECOMMEND_QUESTIONS',
      mode: resolvedSourceResponseId != null ? 'FOLLOW_UP' : 'EXPLICIT_ACTION',
      target: 'THREAD_SIDECAR',
      source: 'derived',
      sourceThreadId: fallbackThreadId,
      sourceResponseId: resolvedSourceResponseId,
      confidence: null,
      artifactPlan: resolveDefaultArtifactPlanForIntent('RECOMMEND_QUESTIONS'),
      conversationAidPlan: {
        threadAids: ['suggested_questions'],
      },
    },
    sourceResponseId: resolvedSourceResponseId,
  };
};

const buildChartComposerIntent = ({
  responses,
  selectedResponse,
  sourceResponseId,
}: {
  responses: ThreadResponse[];
  selectedResponse?: ThreadResponse | null;
  sourceResponseId: number;
}): HomeComposerIntent => {
  const sourceResponse =
    responses.find((response) => response.id === sourceResponseId) || null;
  const sourceThreadId =
    sourceResponse?.threadId ?? selectedResponse?.threadId ?? null;

  return {
    envelope: {
      entrypoint: 'composer',
      intentHint: 'CHART',
      sourceThreadId,
      sourceResponseId,
      sourceWorkbenchArtifacts:
        sourceResponse?.resolvedIntent?.artifactPlan?.workbenchArtifacts ||
        selectedResponse?.resolvedIntent?.artifactPlan?.workbenchArtifacts ||
        null,
      preferredWorkbenchArtifact: 'chart',
    },
    resolvedIntent: {
      kind: 'CHART',
      mode: 'FOLLOW_UP',
      target: 'THREAD_RESPONSE',
      source: 'derived',
      sourceThreadId,
      sourceResponseId,
      confidence: null,
      artifactPlan: resolveDefaultArtifactPlanForIntent('CHART'),
      conversationAidPlan: null,
    },
    sourceResponseId,
  };
};

export const resolveChartSourceResponse = (
  responses: ThreadResponse[],
  selectedResponseId?: number | null,
) => {
  const selectedResponse =
    typeof selectedResponseId === 'number'
      ? responses.find((response) => response.id === selectedResponseId) || null
      : null;

  const candidateResponses = [
    selectedResponse,
    ...[...responses].reverse(),
  ].filter((response): response is ThreadResponse => Boolean(response));

  for (const response of candidateResponses) {
    if (!hasResponseSqlArtifact(response)) {
      continue;
    }

    const resolvedIntent = resolveResponseHomeIntent(response);
    const fallbackArtifact = resolveFallbackWorkbenchArtifact(response);
    if (
      resolvedIntent?.kind === 'CHART' ||
      fallbackArtifact === 'preview' ||
      fallbackArtifact === 'sql'
    ) {
      return resolveResponseSourceId(response);
    }
  }

  return null;
};

export const resolveComposerIntent = ({
  draftIntent,
  question,
  responses,
  selectedResponseId,
}: {
  draftIntent?: ComposerDraftIntent | null;
  question: string;
  responses: ThreadResponse[];
  selectedResponseId?: number | null;
}): HomeComposerIntent => {
  const selectedResponse =
    typeof selectedResponseId === 'number'
      ? responses.find((response) => response.id === selectedResponseId) || null
      : null;
  const draftIntentApplies = shouldApplyComposerDraftIntent({
    draftIntent,
    question,
  });

  if (draftIntentApplies && draftIntent?.intentHint === 'RECOMMEND_QUESTIONS') {
    return buildRecommendComposerIntent({
      responses,
      selectedResponse,
      sourceResponseId: draftIntent.sourceResponseId,
    });
  }

  if (draftIntentApplies && draftIntent?.intentHint === 'CHART') {
    const draftSourceResponseId =
      draftIntent.sourceResponseId ??
      resolveChartSourceResponse(responses, selectedResponseId);

    if (draftSourceResponseId) {
      return buildChartComposerIntent({
        responses,
        selectedResponse,
        sourceResponseId: draftSourceResponseId,
      });
    }
  }

  if (isRecommendOnlyComposerQuestion(question)) {
    return buildRecommendComposerIntent({
      responses,
      selectedResponse,
    });
  }

  if (!isChartOnlyComposerQuestion(question)) {
    return buildAskComposerIntent({
      responses,
      selectedResponse,
    });
  }

  const sourceResponseId = resolveChartSourceResponse(
    responses,
    selectedResponseId,
  );
  if (!sourceResponseId) {
    return buildAskComposerIntent({
      responses,
      selectedResponse,
    });
  }

  return buildChartComposerIntent({
    responses,
    selectedResponse,
    sourceResponseId,
  });
};
