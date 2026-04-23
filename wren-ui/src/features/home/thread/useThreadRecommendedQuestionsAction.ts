import { useCallback } from 'react';

import { appMessage as message } from '@/utils/antdAppBridge';
import type { ThreadResponse } from '@/types/home';
import { triggerThreadResponseRecommendations as triggerThreadResponseRecommendationsRequest } from '@/utils/threadRest';
import type { ClientRuntimeScopeSelector } from '@/runtime/client/runtimeScope';
import { useThreadWorkbenchMessages } from './threadWorkbenchMessages';

const reportThreadError = (_error: unknown, fallbackMessage: string) => {
  message.error(fallbackMessage);
};

export function useThreadRecommendedQuestionsAction({
  locale,
  resolveResponseRuntimeScopeSelector,
  startThreadResponsePolling,
  stopThreadResponsePolling,
  upsertThreadResponse,
}: {
  locale?: string | null;
  resolveResponseRuntimeScopeSelector: (
    responseId: number,
  ) => ClientRuntimeScopeSelector;
  startThreadResponsePolling: (responseId: number) => void;
  stopThreadResponsePolling: () => void;
  upsertThreadResponse: (nextResponse: ThreadResponse) => void;
}) {
  const messages = useThreadWorkbenchMessages(locale);

  return useCallback(
    async ({
      question,
      responseId,
    }: {
      question?: string | null;
      responseId?: number | null;
    }) => {
      if (!responseId) {
        message.error(messages.recommendation.notifications.sourceNotReady);
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
        reportThreadError(
          error,
          messages.recommendation.notifications.generateFailed,
        );
        return null;
      }
    },
    [
      messages.recommendation.notifications.generateFailed,
      messages.recommendation.notifications.sourceNotReady,
      resolveResponseRuntimeScopeSelector,
      startThreadResponsePolling,
      stopThreadResponsePolling,
      upsertThreadResponse,
    ],
  );
}
