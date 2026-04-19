import type { MutableRefObject } from 'react';

import type { RecommendedQuestionsTaskStatus } from '@/types/home';

import type { ThreadResponseData } from './threadPageState';
import type { AskPromptRecoveryBridge } from './threadRecoveryOrchestrationTypes';
import useThreadRecommendationPollingEffect from './useThreadRecommendationPollingEffect';
import useThreadRecoveryResponseSyncEffect from './useThreadRecoveryResponseSyncEffect';
import useThreadResponsePollingSettleEffect from './useThreadResponsePollingSettleEffect';

type UseThreadRecoverySyncEffectsArgs = {
  askPrompt: AskPromptRecoveryBridge;
  handleUnfinishedTasks: (responses: ThreadResponseData[]) => void;
  hasExecutableRuntime: boolean;
  onThreadResponseSettled?: () => void;
  pollingResponse?: ThreadResponseData | null;
  recommendedQuestionsStatus?: RecommendedQuestionsTaskStatus | null;
  responses: ThreadResponseData[];
  stopThreadRecommendPolling: () => void;
  stopThreadResponsePolling: () => void;
  storedQuestionsSignatureRef: MutableRefObject<string | null>;
  threadRecommendRequestInFlightRef: MutableRefObject<boolean>;
  threadResponseRequestInFlightRef: MutableRefObject<number | null>;
  pollingResponseIdRef: MutableRefObject<number | null>;
};

export default function useThreadRecoverySyncEffects({
  askPrompt,
  handleUnfinishedTasks,
  hasExecutableRuntime,
  onThreadResponseSettled,
  pollingResponse,
  recommendedQuestionsStatus,
  responses,
  stopThreadRecommendPolling,
  stopThreadResponsePolling,
  storedQuestionsSignatureRef,
  threadRecommendRequestInFlightRef,
  threadResponseRequestInFlightRef,
  pollingResponseIdRef,
}: UseThreadRecoverySyncEffectsArgs) {
  useThreadRecoveryResponseSyncEffect({
    askPrompt,
    handleUnfinishedTasks,
    hasExecutableRuntime,
    responses,
    storedQuestionsSignatureRef,
  });

  useThreadResponsePollingSettleEffect({
    onThreadResponseSettled,
    pollingResponse,
    pollingResponseIdRef,
    stopThreadResponsePolling,
    threadResponseRequestInFlightRef,
  });

  useThreadRecommendationPollingEffect({
    recommendedQuestionsStatus,
    stopThreadRecommendPolling,
    threadRecommendRequestInFlightRef,
  });
}
