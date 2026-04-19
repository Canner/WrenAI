import { useCallback, type MutableRefObject } from 'react';

import {
  resolveThreadRecoveryPlan,
  type ThreadResponseData,
} from './threadPageState';
import { runThreadRecoveryPlan } from './threadRecoveryPlanHelpers';
import type { AskPromptRecoveryBridge } from './threadRecoveryOrchestrationTypes';

type UseThreadRecoveryPlanHandlerArgs = {
  askPrompt: AskPromptRecoveryBridge;
  pollingAskingTaskIdRef: MutableRefObject<string | null>;
  pollingResponseIdRef: MutableRefObject<number | null>;
  startThreadResponsePolling: (responseId: number) => void;
  stopThreadResponsePolling: () => void;
  threadResponseRequestInFlightRef: MutableRefObject<number | null>;
};

export default function useThreadRecoveryPlanHandler({
  askPrompt,
  pollingAskingTaskIdRef,
  pollingResponseIdRef,
  startThreadResponsePolling,
  stopThreadResponsePolling,
  threadResponseRequestInFlightRef,
}: UseThreadRecoveryPlanHandlerArgs) {
  return useCallback(
    (nextResponses: ThreadResponseData[]) => {
      const recoveryPlan = resolveThreadRecoveryPlan({
        responses: nextResponses,
        askingTask: askPrompt.data?.askingTask as any,
        loading: askPrompt.loading,
        currentPollingTaskId: pollingAskingTaskIdRef.current,
        currentPollingResponseId: pollingResponseIdRef.current,
      });

      runThreadRecoveryPlan({
        askPrompt,
        pollingAskingTaskIdRef,
        pollingResponseIdRef,
        recoveryPlan,
        startThreadResponsePolling,
        stopThreadResponsePolling,
        threadResponseRequestInFlightRef,
      });
    },
    [
      askPrompt,
      pollingAskingTaskIdRef,
      pollingResponseIdRef,
      startThreadResponsePolling,
      stopThreadResponsePolling,
      threadResponseRequestInFlightRef,
    ],
  );
}
