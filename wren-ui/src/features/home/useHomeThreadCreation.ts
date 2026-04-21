import { useRef } from 'react';

import { appMessage as message } from '@/utils/antdAppBridge';
import type { CreateThreadInput } from '@/types/home';
import { type ClientRuntimeScopeSelector } from '@/runtime/client/runtimeScope';
import { Path } from '@/utils/enum';
import { createAskingTask, createThread } from '@/utils/homeRest';
import { HISTORICAL_SNAPSHOT_READONLY_HINT } from '@/utils/runtimeSnapshot';
import { resolveCreatedThreadRuntimeSelector } from './homePageRuntime';

const reportHomeError = (_error: unknown, fallbackMessage: string) => {
  message.error(fallbackMessage);
};

const buildThreadScopeParams = (
  knowledgeBaseIds: string[],
): Record<string, string> => {
  const params: Record<string, string> = {};
  if (knowledgeBaseIds.length > 0) {
    params.knowledgeBaseIds = knowledgeBaseIds.join(',');
  }
  return params;
};

const buildAskPayload = ({
  question,
  knowledgeBaseIds,
  selectedSkillIds,
}: {
  question: string;
  knowledgeBaseIds: string[];
  selectedSkillIds: string[];
}) => ({
  question,
  ...(knowledgeBaseIds.length > 0 ? { knowledgeBaseIds } : {}),
  ...(selectedSkillIds.length > 0 ? { selectedSkillIds } : {}),
});

const buildCreateThreadPayload = ({
  payload,
  knowledgeBaseIds,
  selectedSkillIds,
}: {
  payload: CreateThreadInput;
  knowledgeBaseIds: string[];
  selectedSkillIds: string[];
}) => ({
  ...payload,
  ...(knowledgeBaseIds.length > 0 ? { knowledgeBaseIds } : {}),
  ...(selectedSkillIds.length > 0 ? { selectedSkillIds } : {}),
});

type RuntimeScopeNavigationLike = {
  push: (
    path: string,
    params?: Record<string, string>,
    selectorOverride?: ClientRuntimeScopeSelector,
  ) => Promise<boolean>;
};

export default function useHomeThreadCreation({
  askRuntimeSelector,
  selectedKnowledgeBaseIds,
  selectedSkillIds,
  hasExecutableAskRuntime,
  isAskRuntimeHistoricalReadonly,
  stopAskPolling,
  runtimeScopeNavigation,
  refetchPersistentShellHistory,
}: {
  askRuntimeSelector: ClientRuntimeScopeSelector;
  selectedKnowledgeBaseIds: string[];
  selectedSkillIds: string[];
  hasExecutableAskRuntime: boolean;
  isAskRuntimeHistoricalReadonly: boolean;
  stopAskPolling: () => void;
  runtimeScopeNavigation: RuntimeScopeNavigationLike;
  refetchPersistentShellHistory: () => void | Promise<unknown>;
}) {
  const promptSubmitInFlightRef = useRef(false);

  const handlePromptSubmit = async (value: string) => {
    if (promptSubmitInFlightRef.current) {
      return;
    }

    if (!hasExecutableAskRuntime) {
      message.warning(
        isAskRuntimeHistoricalReadonly
          ? HISTORICAL_SNAPSHOT_READONLY_HINT
          : '当前没有可用的知识库运行范围。',
      );
      return;
    }

    promptSubmitInFlightRef.current = true;
    try {
      const normalizedQuestion = value.trim();
      if (!normalizedQuestion) {
        return;
      }

      stopAskPolling();

      const askingTaskResponse = await createAskingTask(
        askRuntimeSelector,
        buildAskPayload({
          question: normalizedQuestion,
          knowledgeBaseIds: selectedKnowledgeBaseIds,
          selectedSkillIds,
        }),
      );
      const taskId = askingTaskResponse.id;

      if (!taskId) {
        throw new Error('创建问答任务失败');
      }

      const response = await createThread(
        askRuntimeSelector,
        buildCreateThreadPayload({
          payload: {
            question: normalizedQuestion,
            taskId,
          },
          knowledgeBaseIds: selectedKnowledgeBaseIds,
          selectedSkillIds,
        }),
      );
      const threadId = response.id;
      const threadRuntimeSelector = resolveCreatedThreadRuntimeSelector({
        fallbackSelector: askRuntimeSelector,
        thread: response,
      });

      if (!threadId) {
        throw new Error('创建对话失败');
      }

      void refetchPersistentShellHistory();

      await runtimeScopeNavigation.push(
        `${Path.Home}/${threadId}`,
        buildThreadScopeParams(selectedKnowledgeBaseIds),
        threadRuntimeSelector,
      );
    } catch (error) {
      reportHomeError(error, '创建对话失败，请稍后重试');
    } finally {
      promptSubmitInFlightRef.current = false;
    }
  };

  const onCreateResponse = async (payload: CreateThreadInput) => {
    try {
      stopAskPolling();
      const response = await createThread(
        askRuntimeSelector,
        buildCreateThreadPayload({
          payload,
          knowledgeBaseIds: selectedKnowledgeBaseIds,
          selectedSkillIds,
        }),
      );
      const threadId = response.id;
      const threadRuntimeSelector = resolveCreatedThreadRuntimeSelector({
        fallbackSelector: askRuntimeSelector,
        thread: response,
      });
      if (!threadId) {
        throw new Error('创建对话失败');
      }
      void refetchPersistentShellHistory();
      await runtimeScopeNavigation.push(
        `${Path.Home}/${threadId}`,
        buildThreadScopeParams(selectedKnowledgeBaseIds),
        threadRuntimeSelector,
      );
    } catch (error) {
      reportHomeError(error, '创建对话失败，请稍后重试');
    }
  };

  return {
    handlePromptSubmit,
    onCreateResponse,
  };
}
