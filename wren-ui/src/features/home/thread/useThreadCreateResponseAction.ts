import { useCallback } from 'react';

import { appMessage as message } from '@/utils/antdAppBridge';
import type { CreateThreadResponseInput, ThreadResponse } from '@/types/home';
import type { ClientRuntimeScopeSelector } from '@/runtime/client/runtimeScope';
import { createThreadResponse as createThreadResponseRequest } from '@/utils/threadRest';
import {
  hydrateCreatedThreadResponse,
  resolveCreatedThreadResponsePollingTaskId,
} from './threadPageState';

type AskPromptBridge = {
  data?: {
    askingTask?: unknown;
  } | null;
  onFetching: (queryId: string) => Promise<void>;
  onStopPolling: () => void;
};

const reportThreadError = (_error: unknown, fallbackMessage: string) => {
  message.error(fallbackMessage);
};

export function useThreadCreateResponseAction({
  askPrompt,
  currentThreadId,
  pollingAskingTaskIdRef,
  pollingResponseIdRef,
  runtimeScopeSelector,
  stopThreadResponsePolling,
  threadResponseRequestInFlightRef,
  upsertThreadResponse,
}: {
  askPrompt: AskPromptBridge;
  currentThreadId?: number | null;
  pollingAskingTaskIdRef: React.MutableRefObject<string | null>;
  pollingResponseIdRef: React.MutableRefObject<number | null>;
  runtimeScopeSelector: ClientRuntimeScopeSelector;
  stopThreadResponsePolling: () => void;
  threadResponseRequestInFlightRef: React.MutableRefObject<number | null>;
  upsertThreadResponse: (nextResponse: ThreadResponse) => void;
}) {
  return useCallback(
    async (payload: CreateThreadResponseInput) => {
      try {
        askPrompt.onStopPolling();
        stopThreadResponsePolling();

        if (!currentThreadId) {
          message.error('当前对话尚未就绪，请稍后再试');
          return null;
        }
        const nextResponse = await createThreadResponseRequest(
          runtimeScopeSelector,
          currentThreadId,
          payload,
        );
        const hydratedResponse = hydrateCreatedThreadResponse({
          response: nextResponse,
          taskId: payload.taskId || undefined,
          fallbackAskingTask: askPrompt.data?.askingTask as any,
        });
        upsertThreadResponse(hydratedResponse);

        const nextTaskId = resolveCreatedThreadResponsePollingTaskId({
          response: hydratedResponse,
          taskId: payload.taskId,
        });

        if (nextTaskId) {
          pollingAskingTaskIdRef.current = nextTaskId;
          pollingResponseIdRef.current = null;
          threadResponseRequestInFlightRef.current = null;

          void askPrompt.onFetching(nextTaskId).catch((error) => {
            pollingAskingTaskIdRef.current = null;
            reportThreadError(error, '加载问答任务失败，请稍后重试');
          });
        }

        return hydratedResponse;
      } catch (error) {
        reportThreadError(error, '创建回答失败，请稍后重试');
        return null;
      }
    },
    [
      askPrompt,
      currentThreadId,
      pollingAskingTaskIdRef,
      pollingResponseIdRef,
      runtimeScopeSelector,
      stopThreadResponsePolling,
      threadResponseRequestInFlightRef,
      upsertThreadResponse,
    ],
  );
}
