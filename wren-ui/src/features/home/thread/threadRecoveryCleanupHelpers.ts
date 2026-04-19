import type { ComponentRef, MutableRefObject, RefObject } from 'react';

import Prompt from '@/components/pages/home/prompt';

import type { AskPromptRecoveryBridge } from './threadRecoveryOrchestrationTypes';

export function createThreadRecoveryCleanup({
  askPrompt,
  pollingAskingTaskIdRef,
  pollingResponseIdRef,
  promptRef,
  stopThreadRecommendPolling,
  stopThreadResponsePolling,
  threadRecommendRequestInFlightRef,
  threadResponseRequestInFlightRef,
}: {
  askPrompt: AskPromptRecoveryBridge;
  pollingAskingTaskIdRef: MutableRefObject<string | null>;
  pollingResponseIdRef: MutableRefObject<number | null>;
  promptRef: RefObject<ComponentRef<typeof Prompt> | null>;
  stopThreadRecommendPolling: () => void;
  stopThreadResponsePolling: () => void;
  threadRecommendRequestInFlightRef: MutableRefObject<boolean>;
  threadResponseRequestInFlightRef: MutableRefObject<number | null>;
}) {
  return () => {
    askPrompt.onStopPolling();
    askPrompt.onStopStreaming();
    askPrompt.onStopRecommend();
    stopThreadResponsePolling();
    stopThreadRecommendPolling();
    pollingAskingTaskIdRef.current = null;
    pollingResponseIdRef.current = null;
    threadResponseRequestInFlightRef.current = null;
    threadRecommendRequestInFlightRef.current = false;
    promptRef.current?.close();
  };
}
