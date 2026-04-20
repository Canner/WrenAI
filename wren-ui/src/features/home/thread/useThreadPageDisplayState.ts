import { useMemo } from 'react';
import type { DetailedThread } from '@/types/home';
import { getReferenceDisplayKnowledgeName } from '@/utils/referenceDemoKnowledge';
import {
  buildPendingPromptThreadResponse,
  hasReferenceRenderableResponse,
} from './threadPageState';

const REFERENCE_PRIMARY_QUESTION = '每个供应商单产品的成本趋势';

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
  const pendingPromptResponse = useMemo(
    () =>
      buildPendingPromptThreadResponse({
        thread,
        originalQuestion: askPromptOriginalQuestion,
        askingTask: askPromptAskingTask as any,
        loading: askPromptLoading,
      }),
    [askPromptAskingTask, askPromptLoading, askPromptOriginalQuestion, thread],
  );

  const displayThread = useMemo(() => {
    if (!thread) {
      return null;
    }

    if (!pendingPromptResponse) {
      return thread;
    }

    return {
      ...thread,
      responses: [...thread.responses, pendingPromptResponse],
    };
  }, [pendingPromptResponse, thread]);

  const responses = useMemo(() => thread?.responses || [], [thread]);

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
