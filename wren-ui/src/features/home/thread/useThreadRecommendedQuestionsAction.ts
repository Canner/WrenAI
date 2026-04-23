import { useCallback } from 'react';

import { appMessage as message } from '@/utils/antdAppBridge';
import type { ThreadResponse } from '@/types/home';
import { triggerThreadResponseRecommendations as triggerThreadResponseRecommendationsRequest } from '@/utils/threadRest';
import type { ClientRuntimeScopeSelector } from '@/runtime/client/runtimeScope';

const reportThreadError = (_error: unknown, fallbackMessage: string) => {
  message.error(fallbackMessage);
};

export function useThreadRecommendedQuestionsAction({
  resolveResponseRuntimeScopeSelector,
  startThreadResponsePolling,
  stopThreadResponsePolling,
  upsertThreadResponse,
}: {
  resolveResponseRuntimeScopeSelector: (
    responseId: number,
  ) => ClientRuntimeScopeSelector;
  startThreadResponsePolling: (responseId: number) => void;
  stopThreadResponsePolling: () => void;
  upsertThreadResponse: (nextResponse: ThreadResponse) => void;
}) {
  return useCallback(
    async ({
      question,
      responseId,
    }: {
      question?: string | null;
      responseId?: number | null;
    }) => {
      if (!responseId) {
        message.error('当前回答尚未就绪，请稍后再试');
        return null;
      }

      stopThreadResponsePolling();

      try {
        const nextResponse = await triggerThreadResponseRecommendationsRequest(
          resolveResponseRuntimeScopeSelector(responseId),
          responseId,
          { question },
        );
        upsertThreadResponse(nextResponse);
        startThreadResponsePolling(nextResponse.id);
        return nextResponse;
      } catch (error) {
        reportThreadError(error, '生成推荐追问失败，请稍后重试');
        return null;
      }
    },
    [
      resolveResponseRuntimeScopeSelector,
      startThreadResponsePolling,
      stopThreadResponsePolling,
      upsertThreadResponse,
    ],
  );
}
