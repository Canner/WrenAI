import { useEffect, type MutableRefObject } from 'react';

import { isRecommendedFinished } from '@/hooks/useAskPrompt';
import type { RecommendedQuestionsTaskStatus } from '@/types/home';

import { syncThreadRecommendationPollingState } from './threadRecoveryPollingHelpers';

type UseThreadRecommendationPollingEffectArgs = {
  recommendedQuestionsStatus?: RecommendedQuestionsTaskStatus | null;
  stopThreadRecommendPolling: () => void;
  threadRecommendRequestInFlightRef: MutableRefObject<boolean>;
};

export default function useThreadRecommendationPollingEffect({
  recommendedQuestionsStatus,
  stopThreadRecommendPolling,
  threadRecommendRequestInFlightRef,
}: UseThreadRecommendationPollingEffectArgs) {
  useEffect(() => {
    syncThreadRecommendationPollingState({
      recommendedFinished: isRecommendedFinished(recommendedQuestionsStatus),
      stopThreadRecommendPolling,
      threadRecommendRequestInFlightRef,
    });
  }, [
    recommendedQuestionsStatus,
    stopThreadRecommendPolling,
    threadRecommendRequestInFlightRef,
  ]);
}
