import type { MutableRefObject } from 'react';

import useThreadPollingTimeouts from './useThreadPollingTimeouts';
import useThreadResponsePollingStarter from './useThreadResponsePollingStarter';

type UseThreadRecoveryPollingControlsArgs = {
  fetchThreadResponse: (responseId: number) => Promise<unknown>;
  pollingResponseIdRef: MutableRefObject<number | null>;
  stopThreadRecommendationQuestionsHookPolling: () => void;
  stopThreadResponseHookPolling: () => void;
  threadResponseRequestInFlightRef: MutableRefObject<number | null>;
};

export default function useThreadRecoveryPollingControls({
  fetchThreadResponse,
  pollingResponseIdRef,
  stopThreadRecommendationQuestionsHookPolling,
  stopThreadResponseHookPolling,
  threadResponseRequestInFlightRef,
}: UseThreadRecoveryPollingControlsArgs) {
  const {
    scheduleThreadRecommendPollingStop,
    scheduleThreadResponsePollingStop,
    stopThreadRecommendPolling,
    stopThreadResponsePolling,
  } = useThreadPollingTimeouts({
    stopThreadRecommendationQuestionsHookPolling,
    stopThreadResponseHookPolling,
  });

  const startThreadResponsePolling = useThreadResponsePollingStarter({
    fetchThreadResponse,
    pollingResponseIdRef,
    scheduleThreadResponsePollingStop,
    stopThreadResponsePolling,
    threadResponseRequestInFlightRef,
  });

  return {
    scheduleThreadRecommendPollingStop,
    startThreadResponsePolling,
    stopThreadRecommendPolling,
    stopThreadResponsePolling,
  };
}
