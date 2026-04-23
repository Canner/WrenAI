import { useMemo } from 'react';
import type { DetailedThread } from '@/types/home';
import { getReferenceDisplayKnowledgeName } from '@/utils/referenceDemoKnowledge';
import {
  buildPendingPromptThreadResponse,
  hasReferenceRenderableResponse,
} from './threadPageState';
import {
  hydrateThreadResponseHomeIntent,
  hydrateThreadResponsesHomeIntent,
} from './homeIntentContract';

const REFERENCE_PRIMARY_QUESTION = '每个供应商单产品的成本趋势';

const sortResponsesChronologically = <T extends { id?: number | null }>(
  responses?: T[] | null,
) =>
  [...(responses || [])].sort(
    (left, right) =>
      (left.id ?? Number.MIN_SAFE_INTEGER) -
      (right.id ?? Number.MIN_SAFE_INTEGER),
  );

type RuntimeKnowledgeBase = {
  id: string;
  name?: string | null;
};

export function useThreadPageDisplayState({
  askPromptAskingTask,
  askPromptLoading,
  askPromptOriginalQuestion,
  rawKnowledgeBaseIds,
  runtimeKnowledgeBases,
  shouldForceReferencePreview,
  thread,
  threadId,
}: {
  askPromptAskingTask?: unknown;
  askPromptLoading: boolean;
  askPromptOriginalQuestion?: string | null;
  rawKnowledgeBaseIds?: string | string[];
  runtimeKnowledgeBases: RuntimeKnowledgeBase[];
  shouldForceReferencePreview: boolean;
  thread: DetailedThread | null;
  threadId?: number | null;
}) {
  const pendingPromptResponse = useMemo(() => {
    const pendingResponse = buildPendingPromptThreadResponse({
      thread,
      originalQuestion: askPromptOriginalQuestion,
      askingTask: askPromptAskingTask as any,
      loading: askPromptLoading,
    });

    return pendingResponse
      ? hydrateThreadResponseHomeIntent(pendingResponse)
      : null;
  }, [
    askPromptAskingTask,
    askPromptLoading,
    askPromptOriginalQuestion,
    thread,
  ]);

  const hydratedThread = useMemo(() => {
    if (!thread) {
      return null;
    }

    return {
      ...thread,
      responses: hydrateThreadResponsesHomeIntent(
        sortResponsesChronologically(thread.responses),
      ),
    };
  }, [thread]);

  const displayThread = useMemo(() => {
    if (!hydratedThread) {
      return null;
    }

    if (!pendingPromptResponse) {
      return hydratedThread;
    }

    return {
      ...hydratedThread,
      responses: [...hydratedThread.responses, pendingPromptResponse],
    };
  }, [hydratedThread, pendingPromptResponse]);

  const responses = useMemo(
    () => hydratedThread?.responses || [],
    [hydratedThread],
  );

  const routeKnowledgeBaseIds = useMemo(() => {
    const joinedKnowledgeBaseIds = Array.isArray(rawKnowledgeBaseIds)
      ? rawKnowledgeBaseIds[0]
      : rawKnowledgeBaseIds;

    if (!joinedKnowledgeBaseIds) {
      return [];
    }

    return `${joinedKnowledgeBaseIds}`
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }, [rawKnowledgeBaseIds]);

  const selectedKnowledgeBaseNames = useMemo(() => {
    const threadKnowledgeBaseIds = thread?.knowledgeBaseIds || [];
    const scopedKnowledgeBaseIds =
      threadKnowledgeBaseIds.length > 0
        ? threadKnowledgeBaseIds
        : routeKnowledgeBaseIds.length > 0
          ? routeKnowledgeBaseIds
          : thread?.knowledgeBaseId
            ? [thread.knowledgeBaseId]
            : [];

    if (scopedKnowledgeBaseIds.length === 0) {
      return [];
    }

    return scopedKnowledgeBaseIds.map((knowledgeBaseId: string) => {
      const matchedKnowledgeBase = runtimeKnowledgeBases.find(
        (item) => item.id === knowledgeBaseId,
      );

      return getReferenceDisplayKnowledgeName(
        matchedKnowledgeBase?.name || knowledgeBaseId,
      );
    });
  }, [routeKnowledgeBaseIds, runtimeKnowledgeBases, thread]);

  const latestResponse = responses[responses.length - 1] || null;
  const shouldUseReferencePreview =
    shouldForceReferencePreview &&
    !hasReferenceRenderableResponse(latestResponse);

  const primaryQuestion = shouldUseReferencePreview
    ? responses[0]?.question ||
      latestResponse?.question ||
      REFERENCE_PRIMARY_QUESTION
    : responses[0]?.question ||
      thread?.summary ||
      latestResponse?.question ||
      `对话 #${threadId}`;

  return {
    displayThread,
    pendingPromptResponse,
    primaryQuestion,
    responses,
    selectedKnowledgeBaseNames,
    shouldUseReferencePreview,
  };
}
