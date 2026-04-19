import { useCallback, type MutableRefObject } from 'react';

import { startThreadResponsePollingIfNeeded } from './threadRecoveryPollingHelpers';

type UseThreadResponsePollingStarterArgs = {
  fetchThreadResponse: (responseId: number) => Promise<unknown>;
  pollingResponseIdRef: MutableRefObject<number | null>;
  scheduleThreadResponsePollingStop: () => void;
  stopThreadResponsePolling: () => void;
  threadResponseRequestInFlightRef: MutableRefObject<number | null>;
};

export default function useThreadResponsePollingStarter({
  fetchThreadResponse,
  pollingResponseIdRef,
  scheduleThreadResponsePollingStop,
  stopThreadResponsePolling,
  threadResponseRequestInFlightRef,
}: UseThreadResponsePollingStarterArgs) {
  return useCallback(
    (responseId: number) => {
      startThreadResponsePollingIfNeeded({
        fetchThreadResponse,
        pollingResponseIdRef,
        responseId,
        scheduleThreadResponsePollingStop,
        stopThreadResponsePolling,
        threadResponseRequestInFlightRef,
      });
    },
    [
      fetchThreadResponse,
      pollingResponseIdRef,
      scheduleThreadResponsePollingStop,
      stopThreadResponsePolling,
      threadResponseRequestInFlightRef,
    ],
  );
}
