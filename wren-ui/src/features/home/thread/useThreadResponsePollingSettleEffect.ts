import { useEffect, type MutableRefObject } from 'react';

import {
  getThreadResponseIsFinished,
  type ThreadResponseData,
} from './threadPageState';
import { settleFinishedThreadResponsePolling } from './threadRecoveryPollingHelpers';

type UseThreadResponsePollingSettleEffectArgs = {
  onThreadResponseSettled?: () => void;
  pollingResponse?: ThreadResponseData | null;
  pollingResponseIdRef: MutableRefObject<number | null>;
  stopThreadResponsePolling: () => void;
  threadResponseRequestInFlightRef: MutableRefObject<number | null>;
};

export default function useThreadResponsePollingSettleEffect({
  onThreadResponseSettled,
  pollingResponse,
  pollingResponseIdRef,
  stopThreadResponsePolling,
  threadResponseRequestInFlightRef,
}: UseThreadResponsePollingSettleEffectArgs) {
  useEffect(() => {
    settleFinishedThreadResponsePolling({
      onThreadResponseSettled,
      pollingResponseFinished: getThreadResponseIsFinished(pollingResponse),
      pollingResponseIdRef,
      stopThreadResponsePolling,
      threadResponseRequestInFlightRef,
    });
  }, [
    onThreadResponseSettled,
    pollingResponse,
    pollingResponseIdRef,
    stopThreadResponsePolling,
    threadResponseRequestInFlightRef,
  ]);
}
