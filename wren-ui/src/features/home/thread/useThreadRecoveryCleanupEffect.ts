import {
  useEffect,
  type ComponentRef,
  type MutableRefObject,
  type RefObject,
} from 'react';

import Prompt from '@/components/pages/home/prompt';

import { createThreadRecoveryCleanup } from './threadRecoveryCleanupHelpers';
import type { AskPromptRecoveryBridge } from './threadRecoveryOrchestrationTypes';

type UseThreadRecoveryCleanupEffectArgs = {
  askPrompt: AskPromptRecoveryBridge;
  cleanupThreadRef: MutableRefObject<() => void>;
  pollingAskingTaskIdRef: MutableRefObject<string | null>;
  pollingResponseIdRef: MutableRefObject<number | null>;
  promptRef: RefObject<ComponentRef<typeof Prompt> | null>;
  stopThreadRecommendPolling: () => void;
  stopThreadResponsePolling: () => void;
  threadId?: number | null;
  threadRecommendRequestInFlightRef: MutableRefObject<boolean>;
  threadResponseRequestInFlightRef: MutableRefObject<number | null>;
};

export default function useThreadRecoveryCleanupEffect({
  askPrompt,
  cleanupThreadRef,
  pollingAskingTaskIdRef,
  pollingResponseIdRef,
  promptRef,
  stopThreadRecommendPolling,
  stopThreadResponsePolling,
  threadId,
  threadRecommendRequestInFlightRef,
  threadResponseRequestInFlightRef,
}: UseThreadRecoveryCleanupEffectArgs) {
  useEffect(() => {
    cleanupThreadRef.current = createThreadRecoveryCleanup({
      askPrompt,
      pollingAskingTaskIdRef,
      pollingResponseIdRef,
      promptRef,
      stopThreadRecommendPolling,
      stopThreadResponsePolling,
      threadRecommendRequestInFlightRef,
      threadResponseRequestInFlightRef,
    });
  }, [
    askPrompt,
    cleanupThreadRef,
    pollingAskingTaskIdRef,
    pollingResponseIdRef,
    promptRef,
    stopThreadRecommendPolling,
    stopThreadResponsePolling,
    threadRecommendRequestInFlightRef,
    threadResponseRequestInFlightRef,
  ]);

  useEffect(() => {
    return () => {
      cleanupThreadRef.current();
    };
  }, [cleanupThreadRef, threadId]);
}
