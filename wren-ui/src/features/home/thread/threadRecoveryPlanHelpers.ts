import type { MutableRefObject } from 'react';

import type { ThreadRecoveryPlan } from './threadPageState';
import type { AskPromptRecoveryBridge } from './threadRecoveryOrchestrationTypes';

export function runThreadRecoveryPlan({
  askPrompt,
  pollingAskingTaskIdRef,
  pollingResponseIdRef,
  recoveryPlan,
  startThreadResponsePolling,
  stopThreadResponsePolling,
  threadResponseRequestInFlightRef,
}: {
  askPrompt: AskPromptRecoveryBridge;
  pollingAskingTaskIdRef: MutableRefObject<string | null>;
  pollingResponseIdRef: MutableRefObject<number | null>;
  recoveryPlan: ThreadRecoveryPlan;
  startThreadResponsePolling: (responseId: number) => void;
  stopThreadResponsePolling: () => void;
  threadResponseRequestInFlightRef: MutableRefObject<number | null>;
}) {
  if (recoveryPlan.type === 'suspend') {
    pollingAskingTaskIdRef.current = recoveryPlan.taskId;
    return;
  }

  if (recoveryPlan.type === 'resumeAskingTask') {
    pollingAskingTaskIdRef.current = recoveryPlan.taskId;
    pollingResponseIdRef.current = null;
    void askPrompt.onFetching(recoveryPlan.taskId);
    return;
  }

  if (recoveryPlan.type === 'resumeThreadResponse') {
    askPrompt.onStopPolling();
    pollingAskingTaskIdRef.current = null;
    startThreadResponsePolling(recoveryPlan.responseId);
    return;
  }

  if (recoveryPlan.type === 'clear') {
    askPrompt.onStopPolling();
    stopThreadResponsePolling();
    pollingAskingTaskIdRef.current = null;
    pollingResponseIdRef.current = null;
    threadResponseRequestInFlightRef.current = null;
  }
}
