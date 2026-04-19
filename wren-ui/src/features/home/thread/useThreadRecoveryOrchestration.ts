import { useRef } from 'react';
import type { ThreadRecoveryOrchestrationArgs } from './threadRecoveryOrchestrationTypes';
import useThreadRecoveryCleanupEffect from './useThreadRecoveryCleanupEffect';
import useThreadRecoveryPlanHandler from './useThreadRecoveryPlanHandler';
import useThreadRecoveryPollingControls from './useThreadRecoveryPollingControls';
import useThreadRecoverySyncEffects from './useThreadRecoverySyncEffects';

export type { AskPromptRecoveryBridge } from './threadRecoveryOrchestrationTypes';

export function useThreadRecoveryOrchestration({
  askPrompt,
  fetchThreadResponse,
  hasExecutableRuntime,
  onThreadResponseSettled,
  pollingResponse,
  promptRef,
  recommendedQuestionsStatus,
  responses,
  stopThreadRecommendationQuestionsHookPolling,
  stopThreadResponseHookPolling,
  threadId,
}: ThreadRecoveryOrchestrationArgs) {
  const cleanupThreadRef = useRef<() => void>(() => {});
  const pollingAskingTaskIdRef = useRef<string | null>(null);
  const pollingResponseIdRef = useRef<number | null>(null);
  const storedQuestionsSignatureRef = useRef<string | null>(null);
  const threadRecommendRequestInFlightRef = useRef(false);
  const threadResponseRequestInFlightRef = useRef<number | null>(null);

  const recoveryPollingControls = useThreadRecoveryPollingControls({
    fetchThreadResponse,
    pollingResponseIdRef,
    stopThreadRecommendationQuestionsHookPolling,
    stopThreadResponseHookPolling,
    threadResponseRequestInFlightRef,
  });
  const handleUnfinishedTasks = useThreadRecoveryPlanHandler({
    askPrompt,
    pollingAskingTaskIdRef,
    pollingResponseIdRef,
    startThreadResponsePolling:
      recoveryPollingControls.startThreadResponsePolling,
    stopThreadResponsePolling:
      recoveryPollingControls.stopThreadResponsePolling,
    threadResponseRequestInFlightRef,
  });

  useThreadRecoveryCleanupEffect({
    askPrompt,
    cleanupThreadRef,
    pollingAskingTaskIdRef,
    pollingResponseIdRef,
    promptRef,
    stopThreadRecommendPolling:
      recoveryPollingControls.stopThreadRecommendPolling,
    stopThreadResponsePolling:
      recoveryPollingControls.stopThreadResponsePolling,
    threadId,
    threadRecommendRequestInFlightRef,
    threadResponseRequestInFlightRef,
  });
  useThreadRecoverySyncEffects({
    askPrompt,
    handleUnfinishedTasks,
    hasExecutableRuntime,
    onThreadResponseSettled,
    pollingResponse,
    pollingResponseIdRef,
    recommendedQuestionsStatus,
    responses,
    stopThreadRecommendPolling:
      recoveryPollingControls.stopThreadRecommendPolling,
    stopThreadResponsePolling:
      recoveryPollingControls.stopThreadResponsePolling,
    storedQuestionsSignatureRef,
    threadRecommendRequestInFlightRef,
    threadResponseRequestInFlightRef,
  });

  return {
    pollingAskingTaskIdRef,
    pollingResponseIdRef,
    scheduleThreadRecommendPollingStop:
      recoveryPollingControls.scheduleThreadRecommendPollingStop,
    startThreadResponsePolling:
      recoveryPollingControls.startThreadResponsePolling,
    stopThreadRecommendPolling:
      recoveryPollingControls.stopThreadRecommendPolling,
    stopThreadResponsePolling:
      recoveryPollingControls.stopThreadResponsePolling,
    threadRecommendRequestInFlightRef,
    threadResponseRequestInFlightRef,
  };
}
